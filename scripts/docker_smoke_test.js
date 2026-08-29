import {spawn} from 'node:child_process'

const ROOT_DIR = new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:')
const TIMEOUT_MS = Number(process.env.FRACTO_DOCKER_SMOKE_TIMEOUT_MS || 300000)
const POLL_MS = 2000

if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) throw new Error('FRACTO_DOCKER_SMOKE_TIMEOUT_MS must be a positive number')

const run = (args, quiet = false) => new Promise((resolve, reject) => {
   const child = spawn('docker', ['compose', ...args], {cwd: ROOT_DIR, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: false})
   let output = ''
   child.stdout?.on('data', chunk => { output += chunk })
   child.stderr?.on('data', chunk => { output += chunk })
   child.once('error', reject)
   child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`docker compose ${args.join(' ')} failed with exit code ${code}`)))
})

const wait_for = async (url) => {
   const deadline = Date.now() + TIMEOUT_MS
   let last_error = 'no response'
   while (Date.now() < deadline) {
      try {
         const response = await fetch(url, {signal: AbortSignal.timeout(3000)})
         if (response.ok) return
         last_error = `HTTP ${response.status}`
      } catch (error) {
         last_error = error.message
      }
      await new Promise(resolve => setTimeout(resolve, POLL_MS))
   }
   throw new Error(`${url} did not become ready within ${TIMEOUT_MS}ms (${last_error})`)
}

let started = false
try {
   const running = await run(['ps', '--status', 'running', '-q', 'fracto'], true)
   if (running.trim()) throw new Error('A production Fracto container is already running; stop it before the smoke test')
   await run(['build', 'fracto'])
   await run(['up', '-d', 'fracto'])
   started = true
   await wait_for('http://127.0.0.1:3001/readyz')
   await wait_for('http://127.0.0.1:3004/cache_status')
   await wait_for('http://127.0.0.1:3006/')
   console.log('Docker smoke test passed: supervisor, tile, and UI endpoints are ready.')
} finally {
   if (started) await run(['down'])
}
