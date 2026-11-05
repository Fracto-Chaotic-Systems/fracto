import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import test from 'node:test'
import {context_files, create_context_archive} from '../scripts/docker_build_context.js'
import {build_windows_image, image_build_plan} from '../scripts/build_windows_image.js'

const fixture = t => {
   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-context-test-'))
   const root = path.join(directory, 'source')
   fs.mkdirSync(root)
   const write = (relative, value) => {
      const filename = path.join(root, relative)
      fs.mkdirSync(path.dirname(filename), {recursive: true})
      fs.writeFileSync(filename, value)
   }
   write('.dockerignore', '/.git\n**/.git\n**/node_modules\n**/.env\n**/.env.*\n!**/.env.example\n/config\n/servers/fracto-ai-server/runtime\n')
   write('Dockerfile', 'FROM scratch\nCOPY . /context\n')
   t.after(() => {
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()))
      assert.ok(path.basename(directory).startsWith('fracto-context-test-'))
      fs.rmSync(directory, {recursive: true, force: true})
   })
   return {root, directory, write}
}

// Decode independently, checking each USTAR checksum and payload boundary.
const unpack = archive => {
   const bytes = gunzipSync(fs.readFileSync(archive))
   const records = new Map()
   let offset = 0
   const text = (header, start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '')
   while (bytes.subarray(offset, offset + 512).some(value => value !== 0)) {
      const header = bytes.subarray(offset, offset + 512)
      assert.equal(text(header, 257, 6), 'ustar')
      const expected = Number.parseInt(text(header, 148, 8).trim(), 8)
      let sum = 0
      for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : header[index]
      assert.equal(sum, expected)
      const prefix = text(header, 345, 155)
      const name = (prefix ? `${prefix}/` : '') + text(header, 0, 100)
      const size = Number.parseInt(text(header, 124, 12), 8)
      records.set(name, bytes.subarray(offset + 512, offset + 512 + size))
      offset += 512 + Math.ceil(size / 512) * 512
   }
   assert.ok(bytes.subarray(offset, offset + 1024).equals(Buffer.alloc(1024)))
   return records
}

test('archive excludes credentials, local engines, dependencies and Git while preserving source and examples', async t => {
   const {root, directory, write} = fixture(t)
   for (const name of ['.env', '.env.local', '.git/config', 'config/mysql.json',
      'servers/ai/.env', 'servers/ai/.git/config', 'servers/ai/node_modules/private.js',
      'servers/fracto-ai-server/runtime/inference/machine-token',
      'servers/fracto-ai-server/runtime/ollama/models/weights']) write(name, 'must not ship')
   const binary = Buffer.from([0, 255, 128, 13, 10, 0, 42])
   write('source/binary.dat', binary)
   write('.env.example', 'FRACTO_AI_MODEL=')
   write('servers/ai/.env.example', 'FRACTO_AI_MODEL=')
   const longName = `source/${'long-directory-'.repeat(7)}/data.bin`
   write(longName, binary)
   const archive = path.join(directory, 'context.tar.gz')
   const result = await create_context_archive(root, archive)
   const contents = unpack(archive)
   assert.equal(contents.size, result.files)
   assert.deepEqual([...contents.keys()].sort(), ['.dockerignore', '.env.example', 'Dockerfile', 'servers/ai/.env.example', 'source/binary.dat', longName].sort())
   assert.ok(contents.get('source/binary.dat').equals(binary))
   assert.ok(contents.get(longName).equals(binary))
   write('source/binary.dat', 'new source')
   const second = path.join(directory, 'new-context.tar.gz')
   await create_context_archive(root, second)
   assert.equal(unpack(second).get('source/binary.dat').toString(), 'new source')
})

test('unsupported ignore syntax and archives inside source fail explicitly', async t => {
   const {root, write} = fixture(t)
   await assert.rejects(create_context_archive(root, path.join(root, 'context.tar.gz')), /outside/)
   write('.dockerignore', '/private\n!private/secret\n')
   assert.throws(() => context_files(root), /Unsupported/)
})

const configuration = root => ({services: {
   fracto: {image: 'fracto:local', build: {context: root, dockerfile: 'Dockerfile', args: {VITE_FRACTO_PROD_URL: 'https://example.invalid/path?a=1&b=2'}}},
   'fracto-dev': {image: 'fracto:dev', build: {context: root, target: 'development'}},
}})

test('Compose settings preserve image names, build arguments and development target without shell interpolation', t => {
   const {root} = fixture(t)
   const plan = image_build_plan(configuration(root), root, 'dev')
   assert.deepEqual(plan.map(item => item.name), ['fracto', 'fracto-dev'])
   assert.ok(plan[0].args.includes('VITE_FRACTO_PROD_URL=https://example.invalid/path?a=1&b=2'))
   assert.ok(plan[0].args.includes('fracto:local'))
   assert.ok(plan[1].args.includes('fracto:dev'))
   assert.equal(plan[1].args[plan[1].args.indexOf('--target') + 1], 'development')
   assert.equal(plan[0].args.at(-1), '-')
   const incompatible = configuration(root)
   incompatible.services.fracto.build.secrets = ['private']
   assert.throws(() => image_build_plan(incompatible, root, 'prod'), /Unsupported Compose/)
   assert.throws(() => image_build_plan(configuration(root), root, 'invalid'), /Expected/)
})

test('development builds reuse one fresh archive, and success/failure remove only their own temporary context', async t => {
   const {root} = fixture(t)
   let archives = []
   const run_sync = (command, args) => {
      assert.equal(command, 'docker')
      assert.ok(args.includes('compose.dev.yaml'))
      return {status: 0, stdout: JSON.stringify(configuration(root))}
   }
   await build_windows_image({root, mode: 'dev', run_sync, log() {}, run_build: async (args, archive) => {
      archives.push(archive)
      assert.ok(unpack(archive).has('Dockerfile'))
   }})
   assert.equal(archives.length, 2)
   assert.equal(archives[0], archives[1])
   assert.equal(fs.existsSync(path.dirname(archives[0])), false)
   archives = []
   await assert.rejects(build_windows_image({root, mode: 'dev', run_sync, log() {}, run_build: async (args, archive) => {
      archives.push(archive)
      throw new Error('simulated build failure')
   }}), /simulated build failure/)
   assert.equal(archives.length, 1)
   assert.equal(fs.existsSync(path.dirname(archives[0])), false)
})

test('cold boot uses archive builds and prevents Compose from implicitly rebuilding at startup', () => {
   const source = fs.readFileSync(new URL('../scripts/cold_boot.bat', import.meta.url), 'utf8')
   assert.match(source, /node scripts\\build_windows_image\.js %cold_boot_mode%/)
   assert.doesNotMatch(source, /docker compose build/)
   assert.match(source, /up -d --no-build fracto\r?\n/)
   assert.match(source, /up -d --no-build fracto-dev/)
})
