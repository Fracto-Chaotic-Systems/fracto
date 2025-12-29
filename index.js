import fs from "node:fs";
import express from 'express'
import {
   ALL_SERVICES,
   ASSETS_DIRECTORY,
   EXEC_SYNC_OPTIONS,
   FRACTO_SERVER_PORT, LOGS_DIRECTORY,
   TILES_DIRECTORY,
} from './constants.js'
import {spawn, execSync} from 'child_process'
import chalk from 'chalk';
import path from "path";

const SEPARATOR = path.sep;

import {handle_tile} from "./handlers/main.js";
import {handle_main_status} from "./handlers/status.js";
import {copy_json} from "./utils.js";

if (!fs.existsSync(`.${SEPARATOR}${TILES_DIRECTORY}`)) {
   console.log(chalk.cyan(`creating tiles directory`))
   fs.mkdirSync(`.${SEPARATOR}${TILES_DIRECTORY}`)
}
if (!fs.existsSync(`.${SEPARATOR}${ASSETS_DIRECTORY}`)) {
   console.log(chalk.cyan(`creating assets directory`))
   fs.mkdirSync(`.${SEPARATOR}${ASSETS_DIRECTORY}`)
}
if (!fs.existsSync(`.${SEPARATOR}${LOGS_DIRECTORY}`)) {
   console.log(chalk.cyan(`creating logs directory`))
   fs.mkdirSync(`.${SEPARATOR}${LOGS_DIRECTORY}`)
}
if (!fs.existsSync(`.${SEPARATOR}${LOGS_DIRECTORY}${SEPARATOR}archive`)) {
   console.log(chalk.cyan(`creating log archive directory`))
   fs.mkdirSync(`.${SEPARATOR}${LOGS_DIRECTORY}${SEPARATOR}archive`)
}

const app = express();

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});


let move_command = 'mv'
const platform = process.platform;
if (platform === 'win32') {
   move_command = 'move';
}
try {
   execSync(`${move_command} .${SEPARATOR}${LOGS_DIRECTORY}${SEPARATOR}*.txt .${SEPARATOR}${LOGS_DIRECTORY}${SEPARATOR}archive`)
} catch (e) {
   console.log(e.message)
}

const exec_sync_options = copy_json(EXEC_SYNC_OPTIONS)
exec_sync_options.shell = true
ALL_SERVICES.forEach((service, i) => {
   setTimeout(() => {
      spawn(`node`,
         [
            './scripts/launch_service',
            service.name,
            `>./${LOGS_DIRECTORY}/${service.logfile}`
         ],
         exec_sync_options)
   }, (i + 1) * 15000)
})

// Start the server and listen for incoming requests
app.listen(FRACTO_SERVER_PORT, () => {
   console.log(chalk.green(`Fracto main server is running on http://localhost:${FRACTO_SERVER_PORT}`));
});

app.get('/', handle_main_status)
app.get('/status', handle_tile)