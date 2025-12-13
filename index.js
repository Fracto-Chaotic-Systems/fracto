import express from 'express'
import {EXEC_SYNC_OPTIONS, FRACTO_SERVER_PORT, SERVICE_NAME_DATA} from './constants.js'
import {execSync} from 'child_process'

import {handle_tile} from "./handlers/main.js";
import {handle_main_status} from "./handlers/status.js";

const app = express();

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});

execSync(
   `node ./scripts/launch_service ${SERVICE_NAME_DATA}`,
   EXEC_SYNC_OPTIONS)

// Start the server and listen for incoming requests
app.listen(FRACTO_SERVER_PORT, () => {
   console.log(`Fracto main server is running on http://localhost:${FRACTO_SERVER_PORT}`);
});

app.get('/', handle_main_status)
app.get('/status', handle_tile)