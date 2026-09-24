import {collect_log_records, format_log_records} from '../utils/logging.js'

const SERVICE_SELECTORS = new Set(['main', 'admin', 'data', 'asset', 'tiles', 'ui', 'all'])

export const handle_logs = (req, res) => {
   const service_name = String(req.query.service || 'all')
   if (!SERVICE_SELECTORS.has(service_name)) {
      res.status(400).json({
         error: `Unknown log service '${service_name}'. Expected one of: ${[...SERVICE_SELECTORS].join(', ')}`,
      })
      return
   }
   res.json(format_log_records(service_name, collect_log_records(service_name)))
}
