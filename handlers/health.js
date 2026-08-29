export const create_health_handler = service_states => (req, res) => {
   const services = Object.fromEntries(service_states)
   const ready = [...service_states.values()].every(state => state === 'healthy')
   res.status(req.path === '/readyz' && !ready ? 503 : 200).json({
      status: ready ? 'ready' : 'starting',
      uptime_seconds: Math.round(process.uptime()),
      services,
   })
}
