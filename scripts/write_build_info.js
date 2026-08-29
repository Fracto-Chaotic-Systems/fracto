import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

import {ALL_SERVICES} from '../constants.js'

const root = path.resolve(import.meta.dirname, '..')
const repositories = [
   {name: 'fracto', directory: root},
   ...ALL_SERVICES.map(service => ({
      name: service.name,
      directory: path.join(root, 'servers', service.name),
   })),
]

const git = (directory, args) => {
   const result = spawnSync('git', ['-C', directory, ...args], {encoding: 'utf8'})
   return result.status === 0 ? result.stdout.trim() : null
}

const repositories_info = Object.fromEntries(repositories.map(repository => [repository.name, {
   revision: git(repository.directory, ['rev-parse', 'HEAD']),
   short_revision: git(repository.directory, ['rev-parse', '--short', 'HEAD']),
   branch: git(repository.directory, ['branch', '--show-current']),
   dirty: Boolean(git(repository.directory, ['status', '--porcelain'])),
}]))

const generated_at = new Date().toISOString()
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify({
   version: generated_at.replace(/[-:.TZ]/g, '').slice(0, 14),
   generated_at,
   repositories: repositories_info,
}, null, 2) + '\n')
console.log('Build information written to build-info.json')
