import fs from 'node:fs'
import path from 'node:path'
import {spawn, spawnSync} from 'node:child_process'

import chalk from 'chalk'
import express from 'express'

import {
   ALL_SERVICES,
   ASSETS_DIRECTORY,
   FRACTO_SERVER_PORT,
   LOGS_DIRECTORY,
   SERVICE_NAME_TILES,
} from './constants.js'
import {TILE_DATA_DIRECTORY, TILE_INDEX_ROOT} from './sdk/FractoTilePaths.js'
import {handle_tile} from './handlers/main.js'
import {handle_main_status} from './handlers/status.js'
import {validate_startup} from './scripts/startup_preflight.js'

const STARTUP_TIMEOUT_MS = Number(process.env.FRACTO_STARTUP_TIMEOUT_MS || 300000)
const HEALTH_POLL_MS = 500
const ANSI_ESCAPE_PATTERN = /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~])/g
const child_processes = new Map()
const service_states = new Map(ALL_SERVICES.map(service => [service.name, 'pending']))
let shutting_down = false
let server

if (!Number.isFinite(STARTUP_TIMEOUT_MS) || STARTUP_TIMEOUT_MS <= 0) {
   throw new Error('FRACTO_STARTUP_TIMEOUT_MS must be a positive number')
}

const ensure_runtime_directories = () => {
   [
      TILE_DATA_DIRECTORY,
      TILE_INDEX_ROOT,
      path.join(import.meta.dirname, ASSETS_DIRECTORY),
      path.join(import.meta.dirname, LOGS_DIRECTORY),
   ].forEach(directory => {
      fs.mkdirSync(directory, {recursive: true})
   })
}

const shutdown = signal => {
   if (shutting_down) return
   shutting_down = true
   console.log(chalk.yellow(`Received ${signal}; stopping services.`))
   child_processes.forEach(({child, log_stream}) => {
      if (!child.killed) {
         if (process.platform === 'win32') {
            spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
               stdio: 'ignore',
               shell: false,
            })
         } else {
            child.kill(signal)
         }
      }
      log_stream.end()
   })
}

const exit_after_shutdown = exit_code => {
   if (server) {
      server.close(() => process.exit(exit_code))
   } else {
      process.exit(exit_code)
   }
}

const wait_for_health = async (service, child) => {
   const deadline = Date.now() + STARTUP_TIMEOUT_MS
   const health_url = `http://127.0.0.1:${service.port}/`
   let last_error = 'no response'
   while (Date.now() < deadline) {
      if (child.exitCode !== null) {
         throw new Error(`${service.name} exited with code ${child.exitCode}`)
      }
      try {
         const response = await fetch(health_url, {signal: AbortSignal.timeout(2000)})
         if (response.ok) return
         last_error = `HTTP ${response.status}`
      } catch (error) {
         last_error = error.message
      }
      await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_MS))
   }
   throw new Error(`${service.name} was not healthy after ${STARTUP_TIMEOUT_MS}ms (${last_error})`)
}

const start_service = async (service, show_output = false) => {
   service_states.set(service.name, 'starting')
   console.log(chalk.cyan(`Starting ${service.name}...`))
   const log_path = path.join(import.meta.dirname, LOGS_DIRECTORY, service.logfile)
   const log_stream = fs.createWriteStream(log_path, {flags: 'a'})
   const child = spawn(process.execPath, ['scripts/launch_service.js', service.name], {
      cwd: import.meta.dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
   })
   const forward_output = (source, terminal) => {
      source.on('data', chunk => {
         // Preserve ANSI colors in the terminal, but keep persisted logs plain.
         const text = chunk.toString()
         log_stream.write(text.replace(ANSI_ESCAPE_PATTERN, ''))
         if (show_output) terminal.write(text)
      })
   }
   forward_output(child.stdout, process.stdout)
   forward_output(child.stderr, process.stderr)
   child_processes.set(service.name, {child, log_stream})
   child.once('error', error => console.error(`${service.name}: ${error.message}`))
   await wait_for_health(service, child)
   child.once('exit', (code, signal) => {
      service_states.set(service.name, code === 0 ? 'stopped' : 'failed')
      if (!shutting_down) {
         console.error(chalk.red(`${service.name} stopped unexpectedly (code=${code}, signal=${signal})`))
         shutdown('SIGTERM')
         exit_after_shutdown(1)
      }
   })
   service_states.set(service.name, 'healthy')
   console.log(chalk.green(`${service.name} is healthy on port ${service.port}`))
}

const create_main_server = () => {
   const app = express()
   app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
      next()
   })
   app.get('/', handle_main_status)
   const health_response = (req, res) => {
      const services = Object.fromEntries(service_states)
      const ready = [...service_states.values()].every(state => state === 'healthy')
      res.status(req.path === '/readyz' && !ready ? 503 : 200).json({
         status: ready ? 'ready' : 'starting',
         uptime_seconds: Math.round(process.uptime()),
         services,
      })
   }
   app.get('/healthz', health_response)
   app.get('/readyz', health_response)
   app.get('/status', handle_tile)
   return app.listen(FRACTO_SERVER_PORT, () => {
      console.log(chalk.green(`Fracto main server is running on http://localhost:${FRACTO_SERVER_PORT}`))
   })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
   process.once(signal, () => {
      shutdown(signal)
      exit_after_shutdown(0)
   })
}

ensure_runtime_directories()
await validate_startup()

const tile_service = ALL_SERVICES.find(service => service.name === SERVICE_NAME_TILES)
const remaining_services = ALL_SERVICES.filter(service => service.name !== SERVICE_NAME_TILES)

try {
   console.log(chalk.cyan('Loading compiled tile index before starting any server...'))
   await start_service(tile_service, true)
   console.log(chalk.green('Compiled tile index is ready. Starting Fracto servers.'))

   server = create_main_server()
   for (const service of remaining_services) {
      await start_service(service)
   }
} catch (error) {
   console.error(chalk.red(error.message))
   shutdown('SIGTERM')
   exit_after_shutdown(1)
}
