import {ALL_SERVICE_NAMES, EXEC_SYNC_OPTIONS, SERVICE_NAME_DATA} from "../constants.js";
import * as fs from "node:fs";
import {execSync} from 'child_process'

const service_name = process.argv[2]

if (!ALL_SERVICE_NAMES.includes(service_name)) {
   console.log('bad service name', service_name)
   process.exit(1);
}

const exec_sync_options = JSON.parse(JSON.stringify(EXEC_SYNC_OPTIONS))

const server_main_folder = `./servers`
if (!fs.existsSync(server_main_folder)) {
   fs.mkdirSync(server_main_folder)
}

const server_folder = (`${server_main_folder}/${service_name}`)
if (!fs.existsSync(server_folder)) {
   const repo_url = `https://github.com/Fracto-Chaotic-Systems/${service_name}.git`
   exec_sync_options.cwd = server_main_folder
   execSync(`git clone ${repo_url}`, exec_sync_options)
}

exec_sync_options.cwd = server_folder
execSync(`npm i`, exec_sync_options)
