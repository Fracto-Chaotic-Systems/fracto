import fs from 'node:fs'
import path from 'node:path'
import {spawn, spawnSync} from 'node:child_process'

import {ALL_SERVICES, SERVICE_NAME_UI} from '../constants.js'

const service_name = process.argv[2]
const service = ALL_SERVICES.find(candidate => candidate.name === service_name)

if (!service) {
   console.error(`Unknown service: ${service_name || '<missing>'}`)
   process.exit(1)
}

const service_folder = path.join(import.meta.dirname, '..', 'servers', service.name)
const package_file = path.join(service_folder, 'package.json')
const modules_folder = path.join(service_folder, 'node_modules')
const static_ui = service.name === SERVICE_NAME_UI && process.env.FRACTO_UI_MODE === 'static'

if (!fs.existsSync(package_file)) {
   console.error(`Missing ${package_file}. Check out the service before starting Fracto.`)
   process.exit(1)
}
if (!static_ui && !fs.existsSync(modules_folder)) {
   console.error(`Missing dependencies for ${service.name}. Run npm install in ${service_folder}.`)
   process.exit(1)
}

const command = process.execPath
const args = static_ui
   ? [path.join('scripts', 'serve_ui.js')]
   : service.name === SERVICE_NAME_UI
      ? [path.join('node_modules', 'vite', 'bin', 'vite.js')]
      : ['--max-old-space-size=16384', 'index.js']

const child = spawn(command, args, {
   cwd: static_ui ? path.join(import.meta.dirname, '..') : service_folder,
   stdio: 'inherit',
   shell: false,
})

child.once('error', error => {
   console.error(`Unable to start ${service.name}:`, error.message)
   process.exit(1)
})
child.once('exit', (code, signal) => {
   process.exitCode = code ?? (signal ? 1 : 0)
})

const shutdown = signal => {
   if (child.killed) return
   if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
         stdio: 'ignore',
         shell: false,
      })
   } else {
      child.kill(signal)
   }
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
