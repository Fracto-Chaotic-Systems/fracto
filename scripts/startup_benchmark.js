import {start_windows_startup_benchmark} from '../utils/startup_benchmark.js'

const port_index = process.argv.indexOf('--port')
const port = port_index >= 0 ? Number(process.argv[port_index + 1]) : Number(process.env.FRACTO_SERVER_PORT || 3001)
// Observability must not turn an otherwise valid application launch into a failure.
start_windows_startup_benchmark({port})
