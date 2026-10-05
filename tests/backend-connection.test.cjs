const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto, randomUUID } = require('node:crypto');

// Exercise the real settings/invitation modules with native storage and the
// network boundary replaced, so no real project or device is needed.
function app({ secure = new Map(), browser = new Map(), env = {}, platform = 'ios' } = {}) {
  const cache = new Map();
  const sessionConnections = [];
  const localStorage = {
    getItem: key => browser.get(key) ?? null,
    setItem: (key, value) => browser.set(key, value),
  };
  const storage = {
    getItemAsync: async key => secure.get(key) ?? null,
    setItemAsync: async (key, value) => { secure.set(key, value); },
    deleteItemAsync: async key => { secure.delete(key); },
  };
  const session = async () => {
    sessionConnections.push(load('backend-settings').getBackendSettings());
    return 'device-1';
  };
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const filename = path.resolve('src/lib', `${name}.ts`);
    const mod = { exports: {} };
    cache.set(name, mod);
    const requireMock = spec => {
      if (spec === 'react-native-url-polyfill/auto' || spec === 'expo-sqlite/localStorage/install') return {};
      if (spec === 'react-native') return { Platform: { OS: platform } };
      if (spec === './secure-storage') return { secureStorage: storage };
      if (spec === 'expo-crypto') return { randomUUID, getRandomValues: value => webcrypto.getRandomValues(value) };
      if (spec === 'expo-battery') return { getBatteryLevelAsync: async () => -1 };
      if (spec === '@supabase/supabase-js') return { FunctionsHttpError: class extends Error {} };
      if (spec === './supabase') return {
        ensureDeviceSession: session,
        getSupabase: () => ({ functions: { invoke: async () => ({ data: { ok: true }, error: null }) }, rpc: async name => ({ data: name === 'free360_create_invite' ? '2030-01-01' : 'circle-1', error: null }) }),
      };
      if (spec === './self-hosted') return {
        ensureSelfHostedSession: session,
        createSelfHostedCircle: async () => undefined,
        claimSelfHostedInvite: async () => ({ circleId: 'circle-1' }).circleId,
        createSelfHostedInvite: async () => '2030-01-01',
      };
      if (spec.startsWith('./')) return load(spec.slice(2));
      return require(spec);
    };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { require: requireMock, exports: mod.exports, module: mod, process: { env }, URL, localStorage, TextEncoder, TextDecoder, console, Uint8Array }, { filename });
    return mod.exports;
  }
  return { settings: load('backend-settings'), circle: load('circle'), secure, browser, sessionConnections };
}
const supabase = { backend: 'supabase', url: 'https://group.supabase.co', publishableKey: 'sb_publishable_test123' };
const standalone = { backend: 'self-hosted', url: 'https://free360.test' };
const invitation = connection => ({
  version: 2, connection, projectUrl: connection.url, circleId: 'circle-1', inviteId: 'invite-1', inviteSecret: 'secret',
  encryptionKey: Buffer.alloc(32, 7).toString('base64'), circleName: 'Family',
});

for (const connection of [supabase, standalone]) {
  test(`a fresh phone joins ${connection.backend} from a QR without environment settings`, async () => {
    const phone = app();
    const qr = phone.circle.encodeInvite(invitation(connection));
    const circle = await phone.circle.joinCircle(qr);
    assert.equal(circle.circleId, 'circle-1');
    assert.equal(JSON.stringify(phone.sessionConnections[0]), JSON.stringify(connection));
    const restarted = app(phone);
    assert.equal((await restarted.circle.loadCircle()).circleId, 'circle-1');
    assert.equal(JSON.stringify(restarted.settings.getBackendSettings()), JSON.stringify(connection));
    const ownerInvite = await restarted.circle.createInvite(circle);
    assert.equal(JSON.stringify(restarted.circle.decodeInvite(ownerInvite.qrValue).connection), JSON.stringify(connection));
  });
}

test('invalid URLs, privileged keys, and conflicting URLs do not change saved settings', async () => {
  const phone = app();
  await phone.settings.saveBackendSettings(standalone);
  for (const connection of [
    { ...supabase, url: 'http://group.supabase.co' },
    { ...supabase, url: 'https://user:password@group.supabase.co' },
    { ...supabase, publishableKey: 'sb_secret_private' },
    { ...supabase, publishableKey: 'eyJ.service_role.jwt' },
  ]) {
    await assert.rejects(phone.circle.joinCircle(phone.circle.encodeInvite(invitation(connection))));
  }
  await assert.rejects(phone.circle.joinCircle(phone.circle.encodeInvite({ ...invitation(supabase), projectUrl: standalone.url })));
  assert.equal(JSON.stringify(phone.settings.getBackendSettings()), JSON.stringify(standalone));
  assert.equal(phone.sessionConnections.length, 0);
});

test('an existing circle blocks another invitation and server replacement', async () => {
  const phone = app();
  await phone.circle.joinCircle(phone.circle.encodeInvite(invitation(supabase)));
  await assert.rejects(phone.settings.saveBackendSettings(standalone), /cannot be changed/);
  await assert.rejects(phone.circle.joinCircle(phone.circle.encodeInvite(invitation(standalone))), /already belongs/);
  assert.equal((await phone.circle.loadCircle()).circleId, 'circle-1');
  assert.equal(phone.sessionConnections.length, 1);
});

test('legacy defaults and matching anonymous sessions survive a generic build upgrade', async () => {
  const phone = app({ env: { EXPO_PUBLIC_SUPABASE_URL: supabase.url, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey } });
  await phone.settings.initializeBackendSettings();
  await phone.circle.saveCircle({ ...invitation(supabase), deviceId: 'device-1', isOwner: true });
  phone.browser.set('sb-group-auth-token', 'legacy-session');
  const upgraded = app(phone);
  assert.equal((await upgraded.circle.loadCircle()).isOwner, true);
  assert.equal(upgraded.browser.get(`free360.auth.${encodeURIComponent(supabase.url)}`), 'legacy-session');
});

test('legacy QR requires matching settings and never guesses a backend', async () => {
  const phone = app();
  const old = invitation(supabase);
  delete old.connection;
  const qr = phone.circle.encodeInvite(old);
  await assert.rejects(phone.circle.joinCircle(qr), /older invitation/);
  await phone.settings.saveBackendSettings(supabase);
  assert.equal((await phone.circle.joinCircle(qr)).circleId, 'circle-1');
});

test('storage failure leaves the previous connection active', async () => {
  const phone = app();
  await phone.settings.saveBackendSettings(supabase);
  phone.secure.set = () => { throw new Error('storage unavailable'); };
  await assert.rejects(phone.settings.saveBackendSettings(standalone), /storage unavailable/);
  assert.equal(JSON.stringify(phone.settings.getBackendSettings()), JSON.stringify(supabase));
});

test('pending setup keeps its server locked even while membership recovery is offline', async () => {
  const phone = app();
  await phone.settings.saveBackendSettings(supabase);
  await phone.circle.saveCircle({ ...invitation(supabase), deviceId: 'device-1', isOwner: false, pending: true });
  await assert.rejects(phone.settings.saveBackendSettings(standalone), /cannot be changed/);
});

test('a legacy circle can restore only its original server on a build without defaults', async () => {
  const phone = app();
  await phone.circle.saveCircle({ ...invitation(supabase), deviceId: 'device-1', isOwner: true });
  phone.browser.set('sb-group-auth-token', 'original-session');
  await assert.rejects(phone.settings.saveBackendSettings(standalone), /cannot be changed/);
  await phone.settings.saveBackendSettings(supabase);
  assert.equal((await phone.circle.loadCircle()).isOwner, true);
  assert.equal(phone.browser.get(`free360.auth.${encodeURIComponent(supabase.url)}`), 'original-session');
});

for (const connection of [supabase, standalone]) {
  test(`owner configures ${connection.backend} once and shares a complete invitation`, async () => {
    const owner = app();
    await owner.settings.saveBackendSettings(connection);
    const circle = await owner.circle.createCircle('Family', '1234567890123456');
    assert.equal(circle.isOwner, true);
    const qr = await owner.circle.createInvite(circle);
    const guest = app();
    await guest.settings.initializeBackendSettings();
    assert.equal(JSON.stringify(guest.circle.decodeInvite(qr.qrValue).connection), JSON.stringify(connection));
  });
}

test('damaged encryption keys never configure the phone or create a session', async () => {
  const phone = app();
  const bad = { ...invitation(supabase), encryptionKey: 'YQ==' };
  await assert.rejects(phone.circle.joinCircle(phone.circle.encodeInvite(bad)), /encryption key/);
  assert.equal(phone.settings.getBackendSettings(), null);
  assert.equal(phone.sessionConnections.length, 0);
});
