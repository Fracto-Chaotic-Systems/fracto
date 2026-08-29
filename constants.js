const environment = import.meta.env ?? globalThis.process?.env ?? {}
const port = (name, fallback) => Number(environment[name] ?? environment[`VITE_${name}`] ?? fallback)

export const FRACTO_SERVER_PORT = port('FRACTO_SERVER_PORT', 3001)
export const FRACTO_DATA_PORT = port('FRACTO_DATA_PORT', 3002)
export const FRACTO_ASSET_PORT = port('FRACTO_ASSET_PORT', 3003)
export const FRACTO_TILES_PORT = port('FRACTO_TILES_PORT', 3004)
export const FRACTO_ADMIN_PORT = port('FRACTO_ADMIN_PORT', 3005)
export const FRACTO_UI_PORT = port('FRACTO_UI_PORT', 3006)

export const ROOT_DIR = import.meta.dirname

export const SERVICE_NAME_DATA = 'fracto-data-server'
export const SERVICE_NAME_ASSET = 'fracto-asset-server'
export const SERVICE_NAME_TILES = 'fracto-tiles-server'
export const SERVICE_NAME_ADMIN = 'fracto-admin-server'
export const SERVICE_NAME_UI = 'fracto-ui'

export const ASSETS_DIRECTORY = 'assets'
export const LOGS_DIRECTORY = 'logs'

const currentDate = new Date();
const formattedDate = currentDate.toISOString().split('T')[0]

export const LOGFILE_NAME_DATA = `${SERVICE_NAME_DATA}-log-${formattedDate}.txt`
export const LOGFILE_NAME_ASSET = `${SERVICE_NAME_ASSET}-log-${formattedDate}.txt`
export const LOGFILE_NAME_TILES = `${SERVICE_NAME_TILES}-log-${formattedDate}.txt`
export const LOGFILE_NAME_ADMIN = `${SERVICE_NAME_ADMIN}-log-${formattedDate}.txt`
export const LOGFILE_NAME_UI = `${SERVICE_NAME_UI}-log-${formattedDate}.txt`

export const ALL_SERVICES = [
   {
      name:SERVICE_NAME_DATA,
      port: FRACTO_DATA_PORT,
      health_path: '/healthz',
      logfile: LOGFILE_NAME_DATA
   },
   {
      name:SERVICE_NAME_ASSET,
      port: FRACTO_ASSET_PORT,
      logfile: LOGFILE_NAME_ASSET
   },
   {
      name:SERVICE_NAME_ADMIN,
      port: FRACTO_ADMIN_PORT,
      logfile: LOGFILE_NAME_ADMIN
   },
   {
      name:SERVICE_NAME_UI,
      port: FRACTO_UI_PORT,
      logfile: LOGFILE_NAME_UI
   },
   {
      name:SERVICE_NAME_TILES,
      port: FRACTO_TILES_PORT,
      logfile: LOGFILE_NAME_TILES
   },
]

export const EXEC_SYNC_OPTIONS = {
   stdio: 'inherit',
   stderr: 'inherit',
   stdout: 'inherit',
}
