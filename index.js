import fs from "node:fs";
import express from 'express'
import {
   ALL_SERVICE_NAMES, ASSETS_DIRECTORY,
   EXEC_SYNC_OPTIONS,
   FRACTO_SERVER_PORT, TILES_DIRECTORY,
} from './constants.js'
import {spawn} from 'child_process'
import chalk from 'chalk';

import {handle_tile} from "./handlers/main.js";
import {handle_main_status} from "./handlers/status.js";

if (!fs.existsSync(`./${TILES_DIRECTORY}`)) {
   console.log(chalk.cyan(`creating tiles directory`))
   fs.mkdirSync(`./${TILES_DIRECTORY}`)
}
if (!fs.existsSync(`./${ASSETS_DIRECTORY}`)) {
   console.log(chalk.cyan(`creating assets directory`))
   fs.mkdirSync(`./${ASSETS_DIRECTORY}`)
}

const app = express();

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});

const exec_sync_options = JSON.parse(JSON.stringify(EXEC_SYNC_OPTIONS))
exec_sync_options.shell = true
ALL_SERVICE_NAMES.forEach((name, i) => {
   setTimeout(() => {
      spawn(
         `node`,
         ['./scripts/launch_service', name],
         exec_sync_options)
   }, (i+1) * 3000)
})

// Start the server and listen for incoming requests
app.listen(FRACTO_SERVER_PORT, () => {
   console.log(chalk.green(`Fracto main server is running on http://localhost:${FRACTO_SERVER_PORT}`));
});

app.get('/', handle_main_status)
app.get('/status', handle_tile)