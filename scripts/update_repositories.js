import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

import {ALL_SERVICES} from '../constants.js'

const ROOT_DIRECTORY = path.join(import.meta.dirname, '..')
const ALLOWED_UNSTAGED_FILES = new Set(['.idea/fracto.iml'])
const repositories = [
   {name: 'fracto', directory: ROOT_DIRECTORY},
   ...ALL_SERVICES.map(service => ({
      name: service.name,
      directory: path.join(ROOT_DIRECTORY, 'servers', service.name),
   })),
]

const run_git = (repository, args, allow_failure = false) => {
   const result = spawnSync('git', ['-C', repository.directory, ...args], {
      encoding: 'utf8',
      shell: false,
   })
   if (!allow_failure && result.status !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`
      throw new Error(`${repository.name}: git ${args.join(' ')} failed: ${detail}`)
   }
   return result
}

const git_output = (repository, args) => run_git(repository, args).stdout.trim()

const unstaged_changes = repository => git_output(repository, ['diff', '--name-only'])
   .split(/\r?\n/).filter(Boolean)

const assert_repository_ready = repository => {
   if (!fs.existsSync(path.join(repository.directory, '.git'))) {
      throw new Error(`${repository.name}: missing Git repository at ${repository.directory}`)
   }
   const local_changes = unstaged_changes(repository)
   const has_disallowed_unstaged = local_changes.some(file => !ALLOWED_UNSTAGED_FILES.has(file))
   if (has_disallowed_unstaged || run_git(repository, ['diff', '--cached', '--quiet'], true).status !== 0) {
      throw new Error(`${repository.name}: tracked changes must be committed, stashed, or reverted before startup`)
   }
   if (local_changes.length) console.log(`${repository.name}: allowing known IDE-only change in ${local_changes.join(', ')}`)
   const branch = git_output(repository, ['branch', '--show-current'])
   if (!branch) {
      throw new Error(`${repository.name}: detached HEAD cannot be updated safely`)
   }
   const upstream = git_output(repository, [
      'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}',
   ])
   const separator = upstream.indexOf('/')
   if (separator < 1) {
      throw new Error(`${repository.name}: invalid upstream ${upstream}`)
   }
   return {repository, branch, upstream, remote: upstream.slice(0, separator)}
}

const update_repositories = () => {
   console.log(`Checking ${repositories.length} repositories before startup...`)
   const ready = repositories.map(assert_repository_ready)

   for (const item of ready) {
      console.log(`${item.repository.name}: fetching ${item.remote}...`)
      run_git(item.repository, ['fetch', '--prune', item.remote])
   }

   for (const item of ready) {
      const head_is_ancestor = run_git(
         item.repository,
         ['merge-base', '--is-ancestor', 'HEAD', item.upstream],
         true,
      ).status === 0
      const upstream_is_ancestor = run_git(
         item.repository,
         ['merge-base', '--is-ancestor', item.upstream, 'HEAD'],
         true,
      ).status === 0
      if (!head_is_ancestor && !upstream_is_ancestor) {
         throw new Error(`${item.repository.name}: ${item.branch} has diverged from ${item.upstream}`)
      }
   }

   for (const item of ready) {
      run_git(item.repository, ['merge', '--ff-only', item.upstream])
      const revision = git_output(item.repository, ['rev-parse', '--short', 'HEAD'])
      console.log(`${item.repository.name}: ready at ${revision}`)
   }
   console.log('Repository update phase complete.')
}

try {
   update_repositories()
} catch (error) {
   console.error(`Repository update aborted: ${error.message}`)
   process.exitCode = 1
}
