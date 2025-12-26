import * as fs from "node:fs";
import path from 'path';
import chalk from "chalk";
import {fileURLToPath} from 'url';
import {spawn_async, spawn_sync} from "../utils.js";

import {ALL_SERVICES, SERVICE_NAME_ADMIN} from "../constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEPARATOR = path.sep

const service_name = process.argv[2]

const service = ALL_SERVICES.find(service => service.name === service_name)
if (!service) {
   console.log(chalk.red('bad service name'), service_name)
   process.exit(1);
}

const server_main_folder = `${__dirname}${SEPARATOR}..${SEPARATOR}servers`
if (!fs.existsSync(server_main_folder)) {
   console.log(chalk.cyan(`creating server_main_folder: ${server_main_folder}`))
   fs.mkdirSync(server_main_folder)
}

const server_folder = (`${server_main_folder}${SEPARATOR}${service_name}`)
if (!fs.existsSync(server_folder)) {
   console.log(chalk.cyan(`cloning into server_folder: ${server_folder}`))
   const repo_url = `https://github.com/Fracto-Chaotic-Systems/${service_name}.git`
   spawn_sync(`git`, ['clone', repo_url], server_main_folder)
}

const output_file = `${server_main_folder}`

spawn_sync(`git`, ['pull', 'origin', 'main'], server_folder)
spawn_sync(`npm.cmd`, ['i'], server_folder)
spawn_async(`npm.cmd`, ['run', 'start'], server_folder)
