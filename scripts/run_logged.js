import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'

const ANSI_ESCAPE_PATTERN = /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~])/g
const label = process.argv[2]
const command = process.argv[3]
const command_args = process.argv.slice(4)
const source = command_args.find(argument => /(?:^|[\\/])[A-Za-z0-9_-]+\.(?:js|sh|bat)$/.test(argument)) || command

if (!label || !command) throw new Error('Usage: node scripts/run_logged.js <label> <command> [args...]')

const logs_directory = process.env.FRACTO_LOG_DIR || path.resolve('logs')
fs.mkdirSync(logs_directory, {recursive: true})
const date = new Date().toISOString().slice(0, 10)
const log_path = path.join(logs_directory, `${label}-log-${date}.txt`)
const log_stream = fs.createWriteStream(log_path, {flags: 'a'})
const write_records = (source, level) => {
   let pending = ''
   source.on('data', chunk => {
      const text = chunk.toString()
      const plain = `${pending}${text.replace(ANSI_ESCAPE_PATTERN, '')}`
      const lines = plain.split(/\r?\n/)
      pending = lines.pop() || ''
      lines.filter(Boolean).forEach(message => log_stream.write(`${JSON.stringify({
         timestamp: new Date().toISOString(),
            service: label,
            source,
            level,
         message,
      })}\n`))
   })
   source.on('end', () => {
      if (pending) log_stream.write(`${JSON.stringify({timestamp: new Date().toISOString(), service: label, source, level, message: pending})}\n`)
   })
}

const child = spawn(command, command_args, {stdio: ['inherit', 'pipe', 'pipe'], shell: false})
write_records(child.stdout, 'info')
write_records(child.stderr, 'error')
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
child.once('error', error => {
   log_stream.end()
   console.error(error.message)
   process.exitCode = 1
})
child.once('close', (code, signal) => {
   log_stream.end(() => {
      if (signal) process.kill(process.pid, signal)
      else process.exitCode = code ?? 1
   })
})
