import {ALL_SERVICE_NAMES, EXEC_SYNC_OPTIONS, SERVICE_NAME_DATA} from "../constants.js";
import * as fs from "node:fs";
import {execSync, spawn} from 'child_process'
import path from 'path';
import {fileURLToPath} from 'url';
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEPARATOR = path.sep

const service_name = process.argv[2]

if (!ALL_SERVICE_NAMES.includes(service_name)) {
   console.log('bad service name', service_name)
   process.exit(1);
}

const exec_sync_options = JSON.parse(JSON.stringify(EXEC_SYNC_OPTIONS))

const server_main_folder = `${__dirname}${SEPARATOR}..${SEPARATOR}servers`
if (!fs.existsSync(server_main_folder)) {
   fs.mkdirSync(server_main_folder)
}
console.log(chalk.cyan(`server_main_folder: ${server_main_folder}`))

const server_folder = (`${server_main_folder}${SEPARATOR}${service_name}`)
if (!fs.existsSync(server_folder)) {
   const repo_url = `https://github.com/Fracto-Chaotic-Systems/${service_name}.git`
   exec_sync_options.cwd = server_main_folder
   execSync(`git clone ${repo_url}`, exec_sync_options)
}
console.log(chalk.cyan(`server_folder: ${server_folder}`))

exec_sync_options.cwd = server_folder
exec_sync_options.shell = true
execSync(`npm i`, exec_sync_options)

setTimeout(()=>{
   const child = spawn(`npm.cmd`, ['run', 'start'], exec_sync_options)
   child.on('error', (err) => {
      console.error('Failed to start child process:', err);
   });
   child.on('close', (code) => {
      // console.log(`child process exited with code ${code}`);
   });
   child.on('data', (data) => {
      console.log(data);
   });
},1000)
