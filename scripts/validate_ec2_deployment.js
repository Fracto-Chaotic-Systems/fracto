import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

const ROOT_DIRECTORY = path.resolve(import.meta.dirname, '..')
const SOURCE_TARGET = '/mnt/fracto-tile-source'

const require_value = (environment, name) => {
   const value = environment[name]
   if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Required deployment setting is missing: ${name}`)
   }
   return value.trim()
}

export const validate_ec2_compose_model = model => {
   const service = model?.services?.fracto
   if (!service) throw new Error('Compose model is missing the fracto service')
   const environment = service.environment || {}
   const required_auth = [
      'FRACTO_AUTH_REQUIRED',
      'FRACTO_AUTH_MODE',
      'FRACTO_AUTH_SECURE_COOKIES',
      'FRACTO_OIDC_ISSUER',
      'FRACTO_OIDC_CLIENT_ID',
      'FRACTO_OIDC_CLIENT_SECRET',
      'FRACTO_OIDC_REDIRECT_URI',
      'FRACTO_UI_ORIGIN',
   ]
   required_auth.forEach(name => require_value(environment, name))
   if (environment.FRACTO_AUTH_REQUIRED !== 'true') {
      throw new Error('Set FRACTO_AUTH_REQUIRED=true for the EC2 deployment')
   }
   if (environment.FRACTO_AUTH_MODE !== 'oidc') {
      throw new Error('Set FRACTO_AUTH_MODE=oidc for the EC2 deployment')
   }
   if (environment.FRACTO_AUTH_SECURE_COOKIES !== 'true') {
      throw new Error('Set FRACTO_AUTH_SECURE_COOKIES=true for the HTTPS deployment')
   }

   for (const [name, value] of [
      ['FRACTO_OIDC_ISSUER', environment.FRACTO_OIDC_ISSUER],
      ['FRACTO_OIDC_REDIRECT_URI', environment.FRACTO_OIDC_REDIRECT_URI],
      ['FRACTO_UI_ORIGIN', environment.FRACTO_UI_ORIGIN],
   ]) {
      let parsed
      try {
         parsed = new URL(value)
      } catch {
         throw new Error(`${name} must be an absolute HTTPS URL`)
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
         throw new Error(`${name} must be an absolute HTTPS URL`)
      }
      if (name === 'FRACTO_OIDC_REDIRECT_URI' && !parsed.pathname.endsWith('/auth/callback')) {
         throw new Error('FRACTO_OIDC_REDIRECT_URI must end in /auth/callback')
      }
      if (name === 'FRACTO_UI_ORIGIN' && parsed.pathname !== '/') {
         throw new Error('FRACTO_UI_ORIGIN must contain only the public origin')
      }
   }

   if (environment.FRACTO_TILE_SOURCE_MODE !== 'local') {
      throw new Error('The EC2 tile deployment requires FRACTO_TILE_SOURCE_MODE=local')
   }
   if (environment.FRACTO_TILE_SOURCE_DIR !== SOURCE_TARGET) {
      throw new Error(`FRACTO_TILE_SOURCE_DIR must be ${SOURCE_TARGET} inside the container`)
   }
   const generation = require_value(environment, 'FRACTO_TILE_SOURCE_GENERATION')
   if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(generation)) {
      throw new Error('FRACTO_TILE_SOURCE_GENERATION must be a stable 1-128 character identifier')
   }

   const source_mount = service.volumes?.find(volume => volume.target === SOURCE_TARGET)
   if (!source_mount || source_mount.read_only !== true) {
      throw new Error('The local tile corpus must be mounted read-only at /mnt/fracto-tile-source')
   }
   if (!path.posix.isAbsolute(source_mount.source)) {
      throw new Error('FRACTO_TILE_SOURCE_HOST_DIR must resolve to an absolute EC2 host path')
   }
   return source_mount.source
}

const ensure_untracked = relative_path => {
   const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', relative_path], {
      cwd: ROOT_DIRECTORY,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: false,
   })
   if (result.status === 0) {
      throw new Error(`${relative_path} contains deployment secrets and must not be tracked by Git`)
   }
}

const ensure_private_file = (filepath, label, {owner_uid, allowed_group_uid = null} = {}) => {
   let stats
   try {
      stats = fs.statSync(filepath)
   } catch {
      throw new Error(`Required protected file is missing: ${label}`)
   }
   const mode = stats.mode & 0o777
   if (mode & 0o022) {
      throw new Error(`Protect ${label}: group/world write permission is not allowed (use chmod 600)`)
   }
   if (label === '.env') {
      if (stats.uid !== owner_uid || (mode & 0o077)) {
         throw new Error('Protect .env: make it owned by the installer and accessible only to that account (chmod 600)')
      }
      return
   }
   const readable_by_node = (stats.uid === 1000 && (mode & 0o400)) ||
      (stats.gid === 1000 && (mode & 0o040))
   if (!readable_by_node || (mode & 0o004)) {
      throw new Error(
         `${label} must be readable by the container node user (UID/GID 1000) and not world-readable; protect its ownership and permissions`,
      )
   }
   if (allowed_group_uid !== null && stats.gid !== allowed_group_uid && stats.uid !== 1000) {
      throw new Error(`${label} must be owned by UID 1000 or the configured node group`)
   }
}

const validate_secret_files = () => {
   if (process.platform !== 'linux') {
      throw new Error('The EC2 deployment validator must run on Linux')
   }
   const owner_uid = process.getuid()
   const dotenv_path = path.join(ROOT_DIRECTORY, '.env')
   const mysql_path = path.join(ROOT_DIRECTORY, 'config', 'mysql.json')
   ensure_private_file(dotenv_path, '.env', {owner_uid})
   ensure_private_file(mysql_path, 'config/mysql.json', {owner_uid, allowed_group_uid: 1000})
   ensure_untracked('.env')
   ensure_untracked('config/mysql.json')

   let mysql_config
   try {
      mysql_config = JSON.parse(fs.readFileSync(mysql_path, 'utf8'))
   } catch {
      throw new Error('config/mysql.json is not valid JSON')
   }
   for (const field of ['host', 'user', 'database']) {
      if (typeof mysql_config[field] !== 'string' || !mysql_config[field].trim()) {
         throw new Error(`config/mysql.json must provide a non-empty ${field} field`)
      }
   }

   const config_directory = path.join(ROOT_DIRECTORY, 'config')
   for (const entry of fs.readdirSync(config_directory, {withFileTypes: true})) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const relative_path = path.join('config', entry.name)
      ensure_untracked(relative_path)
      ensure_private_file(path.join(config_directory, entry.name), relative_path, {
         owner_uid,
         allowed_group_uid: 1000,
      })
   }
}

const read_compose_model = () => {
   const result = spawnSync('docker', [
      'compose', '-f', 'compose.yaml', '-f', 'compose.local-tiles.yaml',
      'config', '--format', 'json',
   ], {
      cwd: ROOT_DIRECTORY,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
   })
   if (result.status !== 0) {
      throw new Error('Docker Compose could not produce its resolved deployment model; run docker compose config --quiet for details')
   }
   try {
      return JSON.parse(result.stdout)
   } catch {
      throw new Error('Docker Compose returned an invalid deployment model')
   }
}

const validate_host_source = source_directory => {
   try {
      fs.accessSync(source_directory, fs.constants.R_OK | fs.constants.X_OK)
      if (!fs.statSync(source_directory).isDirectory()) throw new Error('not a directory')
      const has_level_directory = fs.readdirSync(source_directory, {withFileTypes: true})
         .some(entry => entry.isDirectory() && /^L\d{2}$/.test(entry.name))
      if (!has_level_directory) throw new Error('no LNN tile directories')
   } catch {
      throw new Error('FRACTO_TILE_SOURCE_HOST_DIR must name an existing readable/searchable corpus with LNN directories')
   }
}

const main = () => {
   validate_secret_files()
   const source_directory = validate_ec2_compose_model(read_compose_model())
   validate_host_source(source_directory)
   if (process.argv.includes('--source-dir')) {
      process.stdout.write(`${source_directory}\n`)
      return
   }
   console.log('EC2 Compose, authentication, database, secret-file, and tile-mount checks passed.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
   try {
      main()
   } catch (error) {
      console.error(`EC2 deployment validation failed: ${error.message}`)
      process.exitCode = 1
   }
}
