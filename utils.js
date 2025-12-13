import {EXEC_SYNC_OPTIONS} from "./constants.js";
import chalk from "chalk";
import {spawn, spawnSync} from "child_process";
import path from "path";

const SEPARATOR = path.sep

export const spawn_sync = (command, args, folder) => {
   const exec_sync_options = JSON.parse(JSON.stringify(EXEC_SYNC_OPTIONS))
   exec_sync_options.cwd = folder
   exec_sync_options.shell = true
   console.log(chalk.cyan(`${command} ${args.join(' ')}, sync in ${folder.split(SEPARATOR).pop()}`))
   try {
      spawnSync(command, args, exec_sync_options)
   } catch (e) {
      console.log(chalk.red(`error spawning ${command}`), e.message)
   }
}

export const spawn_async = (command, args, folder) => {
   const exec_sync_options = JSON.parse(JSON.stringify(EXEC_SYNC_OPTIONS))
   exec_sync_options.cwd = folder
   exec_sync_options.shell = true
   console.log(chalk.cyan(`${command} ${args.join(' ')}, async in ${folder.split(SEPARATOR).pop()}`))
   try {
      const child = spawn(command, args, exec_sync_options)
      child.on('error', (err) => {
         console.error('Failed to start child process:', err);
      });
      child.on('close', (code) => {
         // console.log(`child process exited with code ${code}`);
      });
      child.on('data', (data) => {
         // console.log(data);
      });
   } catch (e) {
      console.log(chalk.red(`error spawning ${command}`), e.message)
   }
}