import fs from 'node:fs'
import path from 'node:path'

import {ALL_SERVICES, LOGS_DIRECTORY} from '../constants.js'

const service_names = new Set(ALL_SERVICES.map(service => service.name))
const date = () => new Date().toISOString().slice(0, 10)
const logs_directory = () => path.join(import.meta.dirname, '..', LOGS_DIRECTORY)
const root_log_path = () => path.join(logs_directory(), `fracto-root-log-${date()}.txt`)

export const root_log = (message, level = 'info') => {
   const text = String(message)
   fs.mkdirSync(path.dirname(root_log_path()), {recursive: true})
   fs.appendFileSync(root_log_path(), `${JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'fracto-root',
      source: 'index.js',
      level,
      message: text.replace(/\x1B(?:\][^\u0007]*(?:\u0007|\x1B\\)|\[[0-?]*[ -/]*[@-~])/g, ''),
   })}\n`)
}

const log_files = () => {
   const directory = logs_directory()
   if (!fs.existsSync(directory)) return []
   return fs.readdirSync(directory, {withFileTypes: true})
      .filter(entry => entry.isFile() && entry.name.endsWith(`-log-${date()}.txt`))
      .map(entry => path.join(directory, entry.name))
}

const read_records = filepath => fs.readFileSync(filepath, 'utf8')
   .split(/\r?\n/)
   .filter(Boolean)
   .map(line => {
      try {
         return {...JSON.parse(line), log_file: path.basename(filepath)}
      } catch {
         return {message: line, log_file: path.basename(filepath)}
      }
   })

const record_belongs_to = (record, service_name) => {
   if (service_name === 'admin') {
      return !service_names.has(record.service)
   }
   return record.service === service_name || record.log_file.startsWith(`${service_name}-log-`)
}

export const process_logfile = (service_name, res) => {
   const records = log_files()
      .flatMap(read_records)
      .filter(record => record_belongs_to(record, service_name))
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
   const lines = records.map(record => {
      const prefix = service_name === 'admin' && record.service ? `[${record.service}] ` : ''
      const level = record.level && record.level !== 'info' ? `[${record.level}] ` : ''
      return `${prefix}${level}${record.message || ''}`
   })
   const formatted_records = records.map((record, index) => ({
      timestamp: record.timestamp || null,
      message: lines[index],
      level: record.level || 'info',
      kind: record.kind || null,
      statement: record.statement || null,
      segments: record.segments || null,
   }))
   res.json({
      lines,
      records: formatted_records,
      logfile_name: service_name === 'admin'
         ? `root-and-maintenance-log-${date()}.txt`
         : `${service_name}-log-${date()}.txt`,
   })
}
