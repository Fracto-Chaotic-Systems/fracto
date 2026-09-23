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
   const [hash, date, author, message, decorations = ''] = lines.shift().split('\x1f')
   const tags = decorations.split(',')
      .map(value => value.trim())
      .filter(value => value.startsWith('tag: '))
      .map(value => value.slice(5))
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
   return {hash, date, author, message, tags, ...summary}
}

const recent_commits = directory => {
   const output = git(directory, [
      'log', '-100', '--date=iso-strict',
      '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%s%x1f%D',
      '--numstat', '--summary', '--no-renames',
   ])
   if (!output) return []
   return output.split('\x1e').filter(Boolean).map(record => commit_summary(record.trim()))
}

const tag_records = (repository, directory) => {
   const output = git(directory, [
      'for-each-ref', 'refs/tags',
      '--format=%(refname:strip=2)%09%(objectname)%09%(*objectname)%09%(objecttype)%09%(creatordate:iso-strict)',
   ])
   if (!output) return []
   return output.split(/\r?\n/).filter(Boolean).map(line => {
      const [name, object_hash, peeled_hash, object_type, created_at] = line.split('\t')
      return {
         repository,
         name,
         object_hash,
         target_hash: peeled_hash || object_hash,
         object_type,
         created_at,
         annotated: object_type === 'tag',
         timestamp_source: created_at
            ? (object_type === 'tag' ? 'tagger' : 'commit')
            : null,
      }
   })
}

const all_tag_records = repositories.flatMap(repository =>
   tag_records(repository.name, repository.directory))
const tag_events = [...all_tag_records.reduce((grouped, record) => {
   if (!record.name) return grouped
   const event = grouped.get(record.name) || {
      name: record.name,
      occurrences: [],
      repositories: [],
   }
   event.occurrences.push({
      repository: record.repository,
      target_hash: record.target_hash,
      created_at: record.created_at,
      annotated: record.annotated,
      timestamp_source: record.timestamp_source,
   })
   if (!event.repositories.includes(record.repository)) {
      event.repositories.push(record.repository)
   }
   grouped.set(record.name, event)
   return grouped
}, new Map()).values()].map(event => ({
   ...event,
   created_at: event.occurrences
      .map(occurrence => occurrence.created_at)
      .filter(Boolean)
      .sort()[0] || null,
})).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))

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
   tag_records: all_tag_records,
   tag_events,
   repositories: repositories_info,
}, null, 2) + '\n')
console.log('Build information written to build-info.json')
