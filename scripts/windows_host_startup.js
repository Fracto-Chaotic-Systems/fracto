import {start_windows_startup_benchmark} from '../utils/startup_benchmark.js'
import {start_windows_ollama} from '../servers/fracto-ai-server/ollama_windows.js'

const index = process.argv.indexOf('--port')
const port = index >= 0 ? Number(process.argv[index + 1]) : Number(process.env.FRACTO_SERVER_PORT || 3001)
start_windows_startup_benchmark({port})
start_windows_ollama()
