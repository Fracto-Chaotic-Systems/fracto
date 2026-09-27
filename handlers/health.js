export const create_health_handler = (
   service_states,
   build_info = null,
   server_name = process.env.FRACTO_SERVER_NAME || null,
) => (req, res) => {
   // Health responses contain only public status and build diagnostics.
   // Other Fracto browser UIs need to read them cross-origin without cookies.
   res.set('Access-Control-Allow-Origin', '*')
   const services = Object.fromEntries(service_states)
   const ready = [...service_states.values()].every(state => state === 'healthy')
   const configured_server_name = typeof server_name === 'string'
      ? server_name.trim() || null
      : null
   res.status(req.path === '/readyz' && !ready ? 503 : 200).json({
      contract_version: 1,
      server_name: configured_server_name,
      status: ready ? 'ready' : 'starting',
      uptime_seconds: Math.round(process.uptime()),
      services,
      build_info,
   })
}
