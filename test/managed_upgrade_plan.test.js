import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

// Exercise the reconstructed module against the exact helper supplied by the
// lab owner, without importing the controller or contacting a Docker daemon.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-upgrade-plan-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));
for (const [source, target] of [
  ['../scripts/managed-templates/upgrade-plan.mjs', 'upgrade-plan.mjs'],
  ['./fixtures/managed-production/docker-cutover-core.mjs', 'docker-cutover-core.mjs'],
]) fs.copyFileSync(new URL(source, import.meta.url), path.join(directory, target));
const { upgradePayload } = await import(pathToFileURL(path.join(directory, 'upgrade-plan.mjs')));
const { composeSnapshot, pairs, promote } = await import(pathToFileURL(path.join(directory, 'docker-cutover-core.mjs')));
const AI = '/var/lib/fracto/ai';
const INSTRUMENTS = '/var/lib/fracto/instruments';
const CORRECTIONS = '/var/lib/fracto/data-corrections';
const volume = (name, target) => ({ Type: 'volume', Name: name, Source: '/var/lib/docker/volumes/' + name + '/_data', Destination: target, RW: true });
function fixture() {
  const oldImage = { Config: { Env: ['IMAGE_DEFAULT=old', 'FRACTO_AI_MODEL=old-model'], Cmd: ['node', 'index.js'] } };
  const old = {
    Id: 'a'.repeat(64), Image: 'sha256:' + 'b'.repeat(64),
    Config: {
      Env: ['IMAGE_DEFAULT=old', 'FRACTO_AI_MODEL=lab-model', 'CUSTOM=keep', 'TOKEN=a=b'],
      Cmd: ['node', 'index.js'], User: '1000',
      Labels: { custom: 'retain', 'com.docker.compose.service': 'fracto' },
    },
    HostConfig: {
      Binds: ['ai-store:' + AI + ':rw', 'E:/mediaplex/fracto/config:/app/config:ro'],
      Mounts: [{ Type: 'volume', Source: 'tile-index', Target: '/var/lib/fracto/index', ReadOnly: false }],
      PortBindings: { '3001/tcp': [{ HostIp: '127.0.0.1', HostPort: '3001' }] },
      Memory: 123456789, NanoCpus: 2000000000, ExtraHosts: ['host.docker.internal:host-gateway'],
      LogConfig: { Type: 'json-file', Config: { 'max-size': '20m' } },
      RestartPolicy: { Name: 'unless-stopped' }, AutoRemove: false,
    },
    Mounts: [volume('ai-store', AI), volume('tile-index', '/var/lib/fracto/index'),
      volume('tiles', '/var/lib/fracto/tiles'), volume('logs', '/app/logs'),
      volume('assets', '/app/assets'), volume('videos', '/app/videos'),
      { Type: 'bind', Source: '/run/desktop/mnt/host/e/mediaplex/fracto/config', Destination: '/app/config', RW: false }],
    NetworkSettings: { Networks: { lab: { Aliases: ['fracto', 'a'.repeat(64)], IPAMConfig: { IPv4Address: '172.20.0.10' } } } },
  };
  return {
    old, oldImage,
    newImage: { Id: 'sha256:' + 'c'.repeat(64), Config: {
      Env: ['IMAGE_DEFAULT=new', 'FRACTO_AI_MODEL=new-model'],
      Cmd: ['node', '--max-old-space-size=16384', 'index.js'],
      Entrypoint: ['/app/docker-entrypoint.sh'], WorkingDir: '/app', User: 'node',
      Volumes: Object.fromEntries([AI, INSTRUMENTS, CORRECTIONS, '/var/lib/fracto/tiles', '/var/lib/fracto/index', '/app/logs', '/app/assets', '/app/videos'].map(target => [target, {}])),
      Healthcheck: { Test: ['CMD', 'node', '-e', 'production-probe'] },
    } },
    release: 'recovery-test', aiVolume: 'ai-store', preflightVolume: 'scratch-ai',
    volumes: { logs: 'scratch-logs', tiles: 'scratch-tiles', benchmarks: 'scratch-bench' },
    correctionVolume: 'corrections', instrumentVolume: 'instruments',
    runtimeEnvironment: { FRACTO_AI_MODEL: 'selected-model', DEPLOYMENT: 'lab' },
    rehearsal: false, name: 'fracto-production', project: 'fracto-upgrade-test',
  };
}
const mounts = body => [
  ...body.HostConfig.Mounts,
  ...body.HostConfig.Binds.map(bind => {
    const [, Source, Target, flags = ''] = /^(.*):(\/[^:]+)(?::([^:]*))?$/.exec(bind);
    return { Source, Target, ReadOnly: flags.split(',').includes('ro') };
  }),
];

test('production preserves all inspected stores, bind paths, limits, ports, network identity and input objects', () => {
  const args = fixture(), before = structuredClone(args), body = upgradePayload(args);
  assert.deepEqual(args, before);
  for (const mount of args.old.Mounts) {
    const actual = mounts(body).filter(item => item.Target === mount.Destination);
    assert.equal(actual.length, 1, mount.Destination);
    if (mount.Type === 'volume') assert.equal(actual[0].Source, mount.Name);
  }
  assert.ok(body.HostConfig.Binds.includes('E:/mediaplex/fracto/config:/app/config:ro'));
  for (const key of ['Memory', 'NanoCpus', 'ExtraHosts', 'LogConfig', 'RestartPolicy'])
    assert.deepEqual(body.HostConfig[key], args.old.HostConfig[key]);
  assert.deepEqual(body.HostConfig.PortBindings['3001/tcp'], args.old.HostConfig.PortBindings['3001/tcp']);
  assert.equal(body.NetworkingConfig.EndpointsConfig.lab.IPAMConfig.IPv4Address, '172.20.0.10');
  assert.deepEqual(body.NetworkingConfig.EndpointsConfig.lab.Aliases, ['fracto']);
  assert.deepEqual(body.Cmd, args.newImage.Config.Cmd);
  assert.equal(body.User, '1000');
});

test('existing AI structured mount options survive production upgrade', () => {
  const args = fixture();
  args.old.HostConfig.Binds.shift();
  const mount = { Type: 'volume', Source: 'ai-store', Target: AI, ReadOnly: false, VolumeOptions: { NoCopy: true } };
  args.old.HostConfig.Mounts.push(mount);
  assert.deepEqual(mounts(upgradePayload(args)).find(item => item.Target === AI), mount);
});

test('adds missing named correction and instrument volumes without anonymous stores', () => {
  const body = upgradePayload(fixture());
  assert.equal(mounts(body).find(item => item.Target === CORRECTIONS).Source, 'corrections');
  assert.equal(mounts(body).find(item => item.Target === INSTRUMENTS).Source, 'instruments');
  assert.equal(new Set(mounts(body).map(item => item.Target)).size, mounts(body).length);
});

test('existing correction and instrument bind and volume identities take precedence over fallback names', () => {
  const args = fixture();
  args.old.Mounts.push(volume('existing-instruments', INSTRUMENTS),
    { Type: 'bind', Source: '/retained/corrections', Destination: CORRECTIONS, RW: true });
  args.old.HostConfig.Binds.push('/retained/corrections:' + CORRECTIONS + ':rw');
  const actual = mounts(upgradePayload(args));
  assert.equal(actual.find(item => item.Target === INSTRUMENTS).Source, 'existing-instruments');
  assert.equal(actual.find(item => item.Target === CORRECTIONS).Source, '/retained/corrections');
});

test('environment advances image defaults, retains explicit runtime values, then applies selected environment', () => {
  const env = pairs(upgradePayload(fixture()).Env);
  assert.equal(env.IMAGE_DEFAULT, 'new');
  assert.equal(env.CUSTOM, 'keep');
  assert.equal(env.TOKEN, 'a=b');
  assert.equal(env.FRACTO_AI_MODEL, 'selected-model');
  assert.equal(env.DEPLOYMENT, 'lab');
  assert.equal(env.FRACTO_AI_DATA_DIR, AI);
});

test('AI-only rehearsal uses scratch stores, ephemeral loopback port, and no production writes or addresses', () => {
  const args = fixture(); args.rehearsal = true;
  const body = upgradePayload(args);
  assert.deepEqual(body.Cmd, ['node', 'scripts/launch_service.js', 'fracto-ai-server']);
  assert.equal(body.Labels['fracto.rollout.role'], 'ai-preflight');
  assert.equal(body.HostConfig.RestartPolicy.Name, 'no');
  assert.deepEqual(body.HostConfig.PortBindings, { '3007/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }] });
  assert.deepEqual(body.ExposedPorts, { '3007/tcp': {} });
  assert.ok(body.Healthcheck.Test.at(-1).includes('3007/readyz'));
  assert.equal(body.NetworkingConfig.EndpointsConfig.lab.IPAMConfig, undefined);
  assert.deepEqual(body.NetworkingConfig.EndpointsConfig.lab.Aliases, [args.name]);
  const scratch = new Set(['scratch-ai', 'scratch-tiles', 'scratch-logs', 'scratch-bench']);
  for (const mount of mounts(body)) if (!mount.ReadOnly) assert.ok(scratch.has(mount.Source), mount.Target);
  assert.equal(mounts(body).find(item => item.Target === AI).Source, 'scratch-ai');
  assert.equal(pairs(body.Env).FRACTO_TILE_CACHE_READ_ONLY, 'true');
});

test('production payload is accepted by the supplied Compose snapshot helper', () => {
  const body = upgradePayload(fixture());
  const snapshot = composeSnapshot(body, { project: 'lab', name: 'fracto' });
  assert.equal(snapshot.services.fracto.image, body.Image);
  assert.ok(Object.values(snapshot.volumes).some(item => item.name === 'ai-store'));
  assert.ok(Object.values(snapshot.volumes).some(item => item.name === 'instruments'));
  assert.equal(snapshot.services.fracto.volumes.find(item => item.target === '/app/config').source, 'E:/mediaplex/fracto/config');
});

test('rejects mismatched, bind-mounted, read-only or duplicate AI stores', () => {
  for (const mutate of [
    args => { args.aiVolume = 'wrong'; },
    args => { args.old.Mounts[0].Type = 'bind'; },
    args => { args.old.Mounts[0].RW = false; },
    args => { args.old.HostConfig.Binds[0] = 'wrong:' + AI + ':rw'; },
    args => { args.old.HostConfig.Mounts.push({ Type: 'volume', Source: 'ai-store', Target: AI }); },
  ]) { const args = fixture(); mutate(args); assert.throws(() => upgradePayload(args)); }
});

test('rejects rehearsal storage that aliases production or another scratch store', () => {
  for (const mutate of [
    args => { args.preflightVolume = args.aiVolume; },
    args => { args.volumes.logs = 'logs'; },
    args => { args.volumes.logs = args.volumes.tiles; },
    args => { delete args.volumes.tiles; },
  ]) { const args = fixture(); args.rehearsal = true; mutate(args); assert.throws(() => upgradePayload(args)); }
});

test('rejects unknown new anonymous volumes and unsupported retained volume inheritance', () => {
  const args = fixture(); args.newImage.Config.Volumes['/unknown-store'] = {};
  assert.throws(() => upgradePayload(args), /unplanned anonymous volume/);
  delete args.newImage.Config.Volumes['/unknown-store'];
  args.old.HostConfig.VolumesFrom = ['other-container'];
  assert.throws(() => upgradePayload(args), /VolumesFrom/);
});

test('rejects alternate managed data paths instead of silently mounting the wrong stores', () => {
  const args = fixture(); args.runtimeEnvironment.FRACTO_AI_DATA_DIR = '/custom-ai';
  assert.throws(() => upgradePayload(args), /standard path/);
});

for (const failProduction of [false, true]) test(`supplied cutover executes generated plans with ${failProduction ? 'rollback after rejected production' : 'successful promotion'} using a simulated Docker API`, async () => {
  const args = fixture(), state = {}, created = [];
  const containers = new Map([[args.old.Id, { Id: args.old.Id, Image: args.old.Image, Name: '/fracto-production', State: { Running: true } }]]);
  const api = async (method, route, body) => {
    if (route.startsWith('/containers/create?')) {
      created.push(body);
      const id = String(created.length).repeat(64);
      containers.set(id, { Id: id, Image: body.Image, Config: { Labels: body.Labels }, Name: '/' + decodeURIComponent(route.split('name=')[1]), State: { Running: false } });
      return { Id: id };
    }
    const [, id, action] = /^\/containers\/([^/]+)\/(.*)$/.exec(route);
    const container = containers.get(id);
    assert.ok(container, route);
    if (method === 'GET' && action === 'json') return structuredClone(container);
    if (action.startsWith('stop')) container.State.Running = false;
    else if (action === 'start') container.State.Running = true;
    else if (action.startsWith('rename?')) container.Name = '/' + decodeURIComponent(action.split('name=')[1]);
    else throw Error('Unexpected simulated API request: ' + route);
    return {};
  };
  const operation = promote({
    api, record: async phase => { state.phase = phase; }, state,
    payload: (rehearsal, name) => upgradePayload({ ...args, rehearsal, name }),
    check: async (id, options) => {
      if (id !== args.old.Id && !options.aiOnly && failProduction) throw Error('SIMULATED_ACCEPTANCE_FAILURE');
      if (options.aiOnly) assert.equal(created[0].Labels['fracto.rollout.role'], 'ai-preflight');
      return { inference: { request_id: 'test-result' } };
    },
    oldId: args.old.Id, oldName: 'fracto-production', productionName: 'fracto-production',
    rollbackName: 'fracto-rollback-test', rehearsalName: 'fracto-rehearsal-test',
    oldImageId: args.old.Image, newImageId: args.newImage.Id, release: args.release, preflightMode: 'ai-only',
  });
  if (failProduction) {
    await assert.rejects(operation, /SIMULATED_ACCEPTANCE_FAILURE/);
    assert.equal(state.phase, 'rolled_back');
    assert.equal(containers.get(args.old.Id).State.Running, true);
    assert.equal(containers.get(args.old.Id).Name, '/fracto-production');
  } else {
    await operation;
    assert.equal(state.phase, 'promoted');
    assert.equal(containers.get(args.old.Id).State.Running, false);
  }
  assert.equal(created.length, 2);
  assert.equal(mounts(created[0]).find(mount => mount.Target === AI).Source, 'scratch-ai');
  assert.equal(mounts(created[1]).find(mount => mount.Target === AI).Source, 'ai-store');
  assert.equal(containers.size, 3); // No old or failed containers were removed.
});
