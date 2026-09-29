import fs from 'node:fs'
import path from 'node:path'
import {createInterface} from 'node:readline/promises'
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

const run_git = (repository, args, allow_failure = false, show_output = false) => {
   const git_args = show_output
      ? ['-C', repository.directory, '-c', 'color.ui=always', ...args]
      : ['-C', repository.directory, ...args]
   const result = spawnSync('git', git_args, show_output
      ? {stdio: 'inherit', shell: false}
      : {encoding: 'utf8', shell: false})
   if (!allow_failure && result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status}`
      throw new Error(`${repository.name}: git ${args.join(' ')} failed: ${detail}`)
   }
   return result
}

const git_output = (repository, args) => run_git(repository, args).stdout.trim()

export const find_diverged_repositories = (ready, git_runner = run_git) =>
   ready.filter(item => {
      const head_is_ancestor = git_runner(
         item.repository,
         ['merge-base', '--is-ancestor', 'HEAD', item.upstream],
         true,
      ).status === 0
      const upstream_is_ancestor = git_runner(
         item.repository,
         ['merge-base', '--is-ancestor', item.upstream, 'HEAD'],
         true,
      ).status === 0
      return !head_is_ancestor && !upstream_is_ancestor
   })

export const reset_diverged_repositories = (diverged, confirmation, git_runner = run_git) => {
   if (`${confirmation || ''}`.trim() !== 'RESET') return false
   for (const item of diverged) {
      git_runner(item.repository, ['reset', '--hard', item.upstream], false, true)
   }
   return true
}

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

const update_repositories = async () => {
   console.log(`Checking ${repositories.length} repositories before startup...`)
   const ready = repositories.map(assert_repository_ready)

   for (const item of ready) {
      console.log(`${item.repository.name}: fetching ${item.remote}...`)
      run_git(item.repository, ['fetch', '--prune', item.remote], false, true)
   }

   const diverged = find_diverged_repositories(ready)
   if (diverged.length) {
      if (!process.argv.includes('--confirm-reset-diverged')) {
         const details = diverged.map(item => `${item.repository.name}: ${item.branch} has diverged from ${item.upstream}`).join('; ')
         throw new Error(`${details}; cold_boot can reset these repositories after explicit confirmation`)
      }
      console.warn('The following local repository histories have diverged from their upstreams:')
      for (const item of diverged) {
         const local_revision = git_output(item.repository, ['rev-parse', '--short', 'HEAD'])
         const remote_revision = git_output(item.repository, ['rev-parse', '--short', item.upstream])
         console.warn(`  ${item.repository.name}: ${item.branch} ${local_revision} -> ${item.upstream} ${remote_revision}`)
      }
      console.warn('Resetting discards local-only commits and tracked changes in the listed repositories. Untracked files are preserved.')
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
         throw new Error('Cannot confirm a divergence reset without an interactive terminal')
      }
      const readline = createInterface({input: process.stdin, output: process.stdout})
      let answer
      try {
         answer = await readline.question('Type RESET to move the listed repositories to their upstream commits: ')
      } finally {
         readline.close()
      }
      if (!reset_diverged_repositories(diverged, answer)) {
         throw new Error('Divergence reset was not confirmed; no repository branches were reset')
      }
   }

   for (const item of ready) {
      run_git(item.repository, ['merge', '--ff-only', item.upstream], false, true)
      const revision = git_output(item.repository, ['rev-parse', '--short', 'HEAD'])
      console.log(`${item.repository.name}: ready at ${revision}`)
   }
   console.log('Repository update phase complete.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
   try {
      await update_repositories()
   } catch (error) {
      console.error(`Repository update aborted: ${error.message}`)
      process.exitCode = 1
   }
}
