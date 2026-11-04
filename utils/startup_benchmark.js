import path from 'node:path'
import {spawn} from 'node:child_process'

/** Launch the deduplicated Windows host observer without delaying Fracto. */
export const start_windows_startup_benchmark = ({
   port,
   platform = process.platform,
   environment = process.env,
   spawn_process = spawn,
   on_error = () => console.warn('Windows startup benchmark observer could not start'),
} = {}) => {
   if (platform !== 'win32' || environment.FRACTO_STARTUP_BENCHMARK === 'false') return false
   if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
      on_error()
      return false
   }
   try {
      const child = spawn_process('powershell.exe', [
         '-NoProfile', '-File',
         path.resolve(import.meta.dirname, '../scripts/start_windows_benchmark.ps1'),
         '-Port', String(port),
      ], {windowsHide: true, stdio: 'ignore', env: environment})
      child.once('error', on_error)
      // Keep the short bootstrap alive until it has created its hidden worker.
      // The Fracto supervisor itself does not await it or the benchmark.
      child.once('exit', code => { if (code !== 0) on_error() })
      return true
   } catch {
      on_error()
      return false
   }
}
