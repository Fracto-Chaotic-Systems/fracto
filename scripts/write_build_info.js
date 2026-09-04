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

const commit_summary = record => {
   const lines = record.trim().split(/\r?\n/)
   const [hash, date, author, message] = lines.shift().split('\x1f')
   const summary = {files_changed: 0, insertions: 0, deletions: 0, files_created: 0, files_removed: 0}
   lines.forEach(stat => {
      const numstat = stat.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/)
      if (numstat) {
         summary.files_changed++
         if (numstat[1] !== '-') summary.insertions += Number(numstat[1])
         if (numstat[2] !== '-') summary.deletions += Number(numstat[2])
      }
      if (stat.startsWith(' create mode ')) summary.files_created++
      if (stat.startsWith(' delete mode ')) summary.files_removed++
   })
   return {hash, date, author, message, ...summary}
}

const recent_commits = directory => {
   const output = git(directory, [
      'log', '-100', '--date=iso-strict',
      '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%s',
      '--numstat', '--summary', '--no-renames',
   ])
   if (!output) return []
   return output.split('\x1e').filter(Boolean).map(record => commit_summary(record.trim()))
}

const repositories_info = Object.fromEntries(repositories.map(repository => [repository.name, {
   revision: git(repository.directory, ['rev-parse', 'HEAD']),
   short_revision: git(repository.directory, ['rev-parse', '--short', 'HEAD']),
   branch: git(repository.directory, ['branch', '--show-current']),
   dirty: Boolean(git(repository.directory, ['status', '--porcelain'])),
   commits: recent_commits(repository.directory),
}]))

const generated_at = new Date().toISOString()
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify({
   version: generated_at.replace(/[-:.TZ]/g, '').slice(0, 14),
   generated_at,
   repositories: repositories_info,
}, null, 2) + '\n')
console.log('Build information written to build-info.json')
