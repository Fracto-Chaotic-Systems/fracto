import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn, spawnSync} from 'node:child_process'
import {create_context_archive} from './docker_build_context.js'

const ROOT = path.resolve(import.meta.dirname, '..')

export const image_build_plan = (configuration, root, mode) => {
   if (!['prod', 'dev'].includes(mode)) throw new Error('Expected prod or dev build mode')
   return (mode === 'dev' ? ['fracto', 'fracto-dev'] : ['fracto']).map(name => {
      const service = configuration.services?.[name]
      const build = service?.build
      if (!service?.image || !build || path.resolve(build.context) !== path.resolve(root))
         throw new Error(`Unsupported build context/image for ${name}`)
      const supported = new Set(['context', 'dockerfile', 'target', 'args'])
      if (Object.keys(build).some(key => !supported.has(key)))
         throw new Error(`Unsupported Compose build option for ${name}; update the archive builder`)
      const dockerfile = build.dockerfile || 'Dockerfile'
      const relative = path.relative(root, path.resolve(root, dockerfile))
      if (path.isAbsolute(relative) || relative.split(path.sep).includes('..'))
         throw new Error('Dockerfile must be inside the build context')
      const args = ['build', '--progress=plain', '--file', relative.replaceAll('\\', '/'), '--tag', service.image]
      if (build.target) args.push('--target', build.target)
      for (const [key, value] of Object.entries(build.args || {}))
         args.push('--build-arg', value == null ? key : `${key}=${value}`)
      args.push('-')
      return {name, args}
   })
}


export const retain_managed_image = ({root, run_sync = spawnSync, log = console.log}) => {
   const file = path.join(root, '.fracto-production.json')
   if (!fs.existsSync(file)) return null
   const registry = JSON.parse(fs.readFileSync(file, 'utf8'))
   const current = registry.current
   if (registry.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(current?.container_id || '') || !/^sha256:[a-f0-9]{64}$/.test(current?.image_id || ''))
      throw new Error('Invalid managed production identity; refusing image rebuild')
   const run = args => {
      const result = run_sync('docker', args, {cwd: root, encoding: 'utf8', timeout: 30000})
      if (result.error || result.status !== 0) throw new Error('Could not retain the managed production image; restore its retained archive before rebuilding')
      return result.stdout.trim()
   }
   if (run(['container', 'inspect', '--format', '{{.Image}}', current.container_id]) !== current.image_id)
      throw new Error('Managed production identity changed; refusing image rebuild')
   if (run(['image', 'inspect', '--format', '{{.Id}}', current.image_id]) !== current.image_id)
      throw new Error('Managed production image identity changed; refusing image rebuild')
   const tag = 'fracto:retained-' + current.image_id.slice(7)
   run(['image', 'tag', current.image_id, tag])
   if (run(['image', 'inspect', '--format', '{{.Id}}', tag]) !== current.image_id)
      throw new Error('Managed production image retention verification failed')
   log('Retained the active production image before replacing build tags.')
   return tag
}

const run_docker_build = (args, archive, root) => new Promise((resolve, reject) => {
   const descriptor = fs.openSync(archive, 'r')
   let child
   try {
      // Give Docker a binary file descriptor, avoiding Windows text pipelines.
      child = spawn('docker', args, {cwd: root, stdio: [descriptor, 'inherit', 'inherit'], shell: false})
   } catch (error) { fs.closeSync(descriptor); reject(error); return }
   fs.closeSync(descriptor)
   child.once('error', reject)
   child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Docker build failed (${signal || code})`))
   })
})

export const build_windows_image = async ({
   root = ROOT, mode = 'prod', run_sync = spawnSync, run_build = run_docker_build,
   log = console.log,
} = {}) => {
   if (!['prod', 'dev'].includes(mode)) throw new Error('Usage: node scripts/build_windows_image.js [prod|dev]')
   const compose = ['compose', '-f', 'compose.yaml']
   if (mode === 'dev') compose.push('-f', 'compose.dev.yaml')
   compose.push('config', '--format', 'json')
   const result = run_sync('docker', compose, {cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 ** 2})
   if (result.error || result.status !== 0)
      throw new Error('Could not resolve Compose build settings; run docker compose config to diagnose')
   const plan = image_build_plan(JSON.parse(result.stdout), root, mode)
   retain_managed_image({root, run_sync, log})
   const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-build-context-'))
   const archive = path.join(temporary, 'context.tar.gz')
   try {
      log('Packaging current source using .dockerignore exclusions...')
      const context = await create_context_archive(root, archive)
      log(`Packaged ${context.files} files (${(context.bytes / 1024 ** 2).toFixed(1)} MiB compressed).`)
      for (const image of plan) {
         log(`Building ${image.name} from the source archive...`)
         await run_build(image.args, archive, root)
      }
   } finally {
      // Delete only this invocation's verified, newly created temporary directory.
      if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('fracto-build-context-'))
         throw new Error('Unexpected build context temporary directory')
      fs.rmSync(temporary, {recursive: true, force: true})
   }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
   try { await build_windows_image({mode: process.argv[2] || 'prod'}) }
   catch (error) { console.error(`Archive image build failed: ${error.message}`); process.exitCode = 1 }
}
