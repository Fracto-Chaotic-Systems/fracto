import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
   find_diverged_repositories,
   reset_diverged_repositories,
} from '../scripts/update_repositories.js'

test('repository updater identifies histories that diverged on both sides', () => {
   const ready = [
      {repository: {name: 'behind'}, upstream: 'origin/main'},
      {repository: {name: 'ahead'}, upstream: 'origin/main'},
      {repository: {name: 'diverged'}, upstream: 'origin/main'},
   ]
   const git_runner = (repository, args) => {
      const is_head_ancestor = args.at(-1) === 'origin/main'
      const status = repository.name === 'diverged'
         ? 1
         : repository.name === 'ahead'
            ? (is_head_ancestor ? 1 : 0)
            : (is_head_ancestor ? 0 : 1)
      return {status}
   }

   assert.deepEqual(
      find_diverged_repositories(ready, git_runner).map(item => item.repository.name),
      ['diverged'],
   )
})

test('declining the reset confirmation leaves all repository refs untouched', () => {
   const commands = []
   const diverged = [{repository: {name: 'fracto'}, upstream: 'origin/main'}]
   const git_runner = (...args) => commands.push(args)

   assert.equal(reset_diverged_repositories(diverged, 'no', git_runner), false)
   assert.deepEqual(commands, [])
})

test('the exact RESET confirmation moves only divergent branches to upstream', () => {
   const commands = []
   const diverged = [
      {repository: {name: 'fracto'}, upstream: 'origin/main'},
      {repository: {name: 'fracto-data-server'}, upstream: 'origin/main'},
   ]
   const git_runner = (...args) => commands.push(args)

   assert.equal(reset_diverged_repositories(diverged, 'RESET', git_runner), true)
   assert.deepEqual(commands.map(([, args]) => args), [
      ['reset', '--hard', 'origin/main'],
      ['reset', '--hard', 'origin/main'],
   ])
})
