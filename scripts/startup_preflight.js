import fs from 'node:fs'
import path from 'node:path'

import {ALL_SERVICES, SERVICE_NAME_UI} from '../constants.js'

const ROOT_DIRECTORY = path.join(import.meta.dirname, '..')

export const validate_startup = () => {
   const errors = []
   const ports = new Set()

   for (const service of ALL_SERVICES) {
      const service_folder = path.join(ROOT_DIRECTORY, 'servers', service.name)
      const package_file = path.join(service_folder, 'package.json')

      if (!Number.isInteger(service.port) || ports.has(service.port)) {
         errors.push(`${service.name}: invalid or duplicate port ${service.port}`)
      }
      ports.add(service.port)

      if (!fs.existsSync(package_file)) {
         errors.push(`${service.name}: missing package.json`)
         continue
      }
      if (!fs.existsSync(path.join(service_folder, 'node_modules'))) {
         errors.push(`${service.name}: missing node_modules (run npm install in ${service_folder})`)
      }
      if (service.name === SERVICE_NAME_UI) {
         const manifest = JSON.parse(fs.readFileSync(package_file, 'utf8'))
         if (!manifest.scripts?.start) {
            errors.push(`${service.name}: package.json has no start script`)
         }
      } else if (!fs.existsSync(path.join(service_folder, 'index.js'))) {
         errors.push(`${service.name}: missing index.js`)
      }
   }

   if (errors.length) {
      throw new Error(`Startup preflight failed:\n- ${errors.join('\n- ')}`)
   }
   return ALL_SERVICES.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
   try {
      const count = validate_startup()
      console.log(`Startup preflight passed for ${count} services.`)
   } catch (error) {
      console.error(error.message)
      process.exitCode = 1
   }
}
