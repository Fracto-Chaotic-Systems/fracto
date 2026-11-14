# Local instrument transfer verification

`local_topology.js` starts two loopback-only asset/admin pairs with ephemeral
credentials and the real transfer routers. Only the disposable receiver is
initialized or published; source operations are inventory/export reads.
`../../scripts/verify_instrument_transfer.js` drives browser preview/apply/status,
receiver restart, identical-catalog repair, client instrument resolution and WAV
readback using the installed library and an explicit MIDI file. It deletes only
its own uniquely named temporary receiver tree and writes a JSON evidence report.

This is an explicit integration probe, outside ordinary unit-test discovery.
It transfers the entire catalog closure (several GB), requires room for the
verified cache plus receiver dependencies, and never contacts saved remote peers.
It verifies original assignments and checksummed sample data; the
operator still performs production playback/listening after deployment.
