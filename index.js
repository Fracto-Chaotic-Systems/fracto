import express from 'express'
import {ALL_SERVICE_NAMES, EXEC_SYNC_OPTIONS, FRACTO_SERVER_PORT, SERVICE_NAME_DATA} from './constants.js'
import {exec, spawn} from 'child_process'
import chalk from 'chalk';

import {handle_tile} from "./handlers/main.js";
import {handle_main_status} from "./handlers/status.js";

const app = express();

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});

const exec_sync_options = JSON.parse(JSON.stringify(EXEC_SYNC_OPTIONS))
exec_sync_options.shell = true
ALL_SERVICE_NAMES.forEach((name) => {
   spawn(
      `node`,
      ['./scripts/launch_service', SERVICE_NAME_DATA],
      exec_sync_options)
})

// Start the server and listen for incoming requests
app.listen(FRACTO_SERVER_PORT, () => {
   console.log(chalk.green(`Fracto main server is running on http://localhost:${FRACTO_SERVER_PORT}`));
});

app.get('/', handle_main_status)
app.get('/status', handle_tile)