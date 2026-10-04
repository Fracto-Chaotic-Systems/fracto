import {readdirSync} from 'node:fs'
import {extname, join} from 'node:path'
import {spawnSync} from 'node:child_process'

const ROOT_FILES = ['constants.js', 'index.js', 'utils.js']
const SOURCE_DIRECTORIES = ['handlers', 'scripts', 'sdk']
const IGNORED_DIRECTORIES = new Set(['.archive', 'archive'])

const collect_javascript = (directory) => readdirSync(directory, {withFileTypes: true})
   .flatMap(entry => {
      const entry_path = join(directory, entry.name)
      return entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)
         ? collect_javascript(entry_path)
         : !entry.isDirectory() && extname(entry.name) === '.js' ? [entry_path] : []
   })

const files = [
   ...ROOT_FILES,
   ...SOURCE_DIRECTORIES.flatMap(collect_javascript),
]

const failures = files.flatMap(file => {
   const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'})
   return result.status === 0 ? [] : [{file, error: result.stderr.trim()}]
})

if (failures.length) {
   failures.forEach(({file, error}) => console.error(`${file}\n${error}`))
   process.exitCode = 1
} else {
   console.log(`Syntax check passed for ${files.length} JavaScript files.`)
}
