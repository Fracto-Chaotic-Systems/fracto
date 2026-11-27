// Install beside the existing docker-cutover-core.mjs in .fracto-managed.
// Pure payload construction: importing this module never contacts Docker.
import { createHash } from 'node:crypto';
import { planContainer, planAIOnlyPreflight, pairs, mountTargets } from './docker-cutover-core.mjs';

const AI = '/var/lib/fracto/ai';
const CORRECTIONS = '/var/lib/fracto/data-corrections';
const INSTRUMENTS = '/var/lib/fracto/instruments';
const clone = value => structuredClone(value);
const targetOf = bind => {
  const match = /^(.*):(\/[^:]+)(?::([^:]*))?$/.exec(bind);
  if (!match) throw Error('Unrecognized retained bind syntax');
  return match[2];
};
const volumeName = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value))
    throw Error('A valid retained named volume is required');
  return value;
};
const mountedAt = (old, target) => {
  const matches = old.Mounts.filter(mount => mount.Destination === target);
  if (matches.length > 1) throw Error('Duplicate retained mount target: ' + target);
  return matches[0];
};

export function upgradePayload({
  old, oldImage, newImage, release, aiVolume, preflightVolume, volumes = {},
  correctionVolume, instrumentVolume, runtimeEnvironment = {}, rehearsal = false,
  name, project,
}) {
  if (!old?.HostConfig || !old.Config || !Array.isArray(old.Mounts) ||
      !oldImage?.Config || !newImage?.Config || !newImage.Id)
    throw Error('Complete container and image inspection results are required');
  if (typeof rehearsal !== 'boolean') throw Error('Expected a boolean rehearsal flag');
  const ai = mountedAt(old, AI);
  if (ai?.Type !== 'volume' || ai.Name !== volumeName(aiVolume) || !ai.RW)
    throw Error('Existing AI volume identity or write access does not match');

  // Image defaults advance with the image; installation-specific settings survive.
  const baseline = pairs(oldImage.Config.Env);
  const environment = { ...pairs(newImage.Config.Env) };
  for (const [key, value] of Object.entries(pairs(old.Config.Env)))
    if (!(key in baseline) || baseline[key] !== value) environment[key] = value;
  Object.assign(environment, runtimeEnvironment);
  for (const [key, target] of Object.entries({
    FRACTO_AI_DATA_DIR: AI,
    FRACTO_DATA_CORRECTION_DIR: CORRECTIONS,
    FRACTO_INSTRUMENT_DIR: INSTRUMENTS,
  })) {
    if (environment[key] && environment[key] !== target)
      throw Error('Managed upgrade requires the standard path for ' + key);
  }

  const retained = clone(old);
  const originalBinds = (old.HostConfig.Binds || []).filter(bind => targetOf(bind) === AI);
  const originalMounts = (old.HostConfig.Mounts || []).filter(mount => mount.Target === AI);
  if (originalBinds.length + originalMounts.length > 1)
    throw Error('Duplicate retained AI mount configuration');
  for (const source of [
    ...originalBinds.map(bind => bind.slice(0, bind.lastIndexOf(':' + AI))),
    ...originalMounts.map(mount => mount.Source),
  ]) if (source !== aiVolume) throw Error('Configured AI mount differs from its inspected identity');
  // The original rollout helper accepts a new AI store. Strip only the verified
  // existing AI mount from a clone, then supply its production or rehearsal ID.
  retained.HostConfig.Binds = (retained.HostConfig.Binds || []).filter(bind => targetOf(bind) !== AI);
  retained.HostConfig.Mounts = (retained.HostConfig.Mounts || []).filter(mount => mount.Target !== AI);
  retained.Mounts = retained.Mounts.filter(mount => mount.Destination !== AI);
  const selectedAI = rehearsal ? volumeName(preflightVolume) : aiVolume;
  if (rehearsal) {
    const scratch = [selectedAI, ...['logs', 'tiles', 'benchmarks'].map(key => volumeName(volumes[key]))];
    const productionSources = new Set(old.Mounts.flatMap(mount => [mount.Name, mount.Source]).filter(Boolean));
    if (new Set(scratch).size !== scratch.length || scratch.some(source => productionSources.has(source)) ||
        scratch.includes(correctionVolume) || scratch.includes(instrumentVolume))
      throw Error('Rehearsal volumes must be distinct from each other and production storage');
  }
  for (const [target, source] of [[CORRECTIONS, correctionVolume], [INSTRUMENTS, instrumentVolume]]) {
    if (mountedAt(old, target)) continue;
    if (mountTargets(retained.HostConfig).has(target))
      throw Error('Configured mount is missing from container inspection: ' + target);
    if (target === INSTRUMENTS && !newImage.Config.Volumes?.[target]) continue;
    (retained.HostConfig.Mounts ??= []).push({
      Type: 'volume', Source: volumeName(source), Target: target, ReadOnly: false,
    });
  }
  let body = planContainer({
    old: retained, oldImage, newImage, release, aiVolume: selectedAI,
    rehearsal, volumes, runtimeEnvironment, name, project,
  });
  const env = { ...pairs(body.Env), ...environment, FRACTO_AI_DATA_DIR: AI };
  // The controller probes these fixed internal ports during acceptance.
  for (const [key, port] of Object.entries({ SERVER: 3001, DATA: 3002, ASSET: 3003, TILES: 3004, ADMIN: 3005, UI: 3006, AI: 3007 }))
    env['FRACTO_' + key + '_PORT'] = String(port);
  if (rehearsal) env.FRACTO_TILE_CACHE_READ_ONLY = 'true';
  body.Env = Object.entries(env).map(([key, value]) => key + '=' + value);

  if (!rehearsal && originalBinds.length + originalMounts.length) {
    body.HostConfig.Binds = body.HostConfig.Binds.filter(bind => targetOf(bind) !== AI);
    body.HostConfig.Binds.push(...clone(originalBinds));
    body.HostConfig.Mounts.push(...clone(originalMounts));
  }
  if (rehearsal) {
    // Only disposable stores are writable. AI-only startup must never write
    // production corrections, instruments, source tiles, assets, or indexes.
    const scratch = {
      [AI]: selectedAI, '/app/logs': volumes.logs,
      [env.FRACTO_TILE_DATA_DIR || '/var/lib/fracto/tiles']: volumes.tiles,
      '/app/servers/fracto-tiles-server/benchmarks': volumes.benchmarks,
      [CORRECTIONS]: volumes.logs, [INSTRUMENTS]: volumes.logs,
    };
    const host = body.HostConfig;
    host.Binds = host.Binds.map(bind => {
      const target = targetOf(bind);
      if (scratch[target]) return scratch[target] + ':' + target + ':rw';
      const at = bind.lastIndexOf(':' + target);
      const flags = bind.slice(at + target.length + 1).replace(/^:/, '').split(',')
        .filter(flag => flag && flag !== 'rw' && flag !== 'ro');
      return bind.slice(0, at) + ':' + target + ':' + ['ro', ...flags].join(',');
    });
    host.Mounts = host.Mounts.map(mount => scratch[mount.Target]
      ? { Type: 'volume', Source: scratch[mount.Target], Target: mount.Target, ReadOnly: false }
      : { ...mount, ReadOnly: true });
    body = planAIOnlyPreflight(body);
    // Rehearsal must not reserve production addresses, MACs, or aliases.
    for (const endpoint of Object.values(body.NetworkingConfig.EndpointsConfig))
      delete endpoint.IPAMConfig;
  } else {
    body.Labels['com.docker.compose.config-hash'] = createHash('sha256')
      .update(JSON.stringify([body.Image, body.Env, body.HostConfig])).digest('hex');
  }
  return body;
}
