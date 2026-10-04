import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/startup-permissions.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const mod = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const { shouldAskForPermission, ensureStartupPermissions, __resetStartupPermissionsForTests } = mod;

function fakeAdapter(current, afterRequest, calls) {
  return {
    getForegroundPermissionsAsync: async () => {
      calls.gets += 1;
      return current;
    },
    requestForegroundPermissionsAsync: async () => {
      calls.requests += 1;
      return afterRequest;
    },
  };
}

test('startup asks only when the OS will still show a prompt', () => {
  assert.equal(shouldAskForPermission({ granted: true, canAskAgain: true }), false);
  assert.equal(shouldAskForPermission({ granted: true, canAskAgain: false }), false);
  assert.equal(shouldAskForPermission({ granted: false, canAskAgain: true }), true);
  assert.equal(shouldAskForPermission({ granted: false, canAskAgain: false }), false);
  assert.equal(shouldAskForPermission({ granted: false }), false);
  assert.equal(shouldAskForPermission(null), false);
  assert.equal(shouldAskForPermission(undefined), false);
});

test('already-granted permission never prompts', async () => {
  __resetStartupPermissionsForTests();
  const calls = { gets: 0, requests: 0 };
  const result = await ensureStartupPermissions({
    platform: 'ios',
    adapter: fakeAdapter({ granted: true, canAskAgain: true }, { granted: true }, calls),
  });
  assert.deepEqual(result, { outcome: 'already-granted', asked: false });
  assert.equal(calls.requests, 0);
});

test('undetermined permission prompts once and reports the grant', async () => {
  __resetStartupPermissionsForTests();
  const calls = { gets: 0, requests: 0 };
  const result = await ensureStartupPermissions({
    platform: 'android',
    adapter: fakeAdapter(
      { granted: false, canAskAgain: true },
      { granted: true, canAskAgain: true },
      calls,
    ),
  });
  assert.deepEqual(result, { outcome: 'granted-after-request', asked: true });
  assert.equal(calls.requests, 1);
});

test('denied request is reported without looping', async () => {
  __resetStartupPermissionsForTests();
  const calls = { gets: 0, requests: 0 };
  const result = await ensureStartupPermissions({
    platform: 'android',
    adapter: fakeAdapter(
      { granted: false, canAskAgain: true },
      { granted: false, canAskAgain: false },
      calls,
    ),
  });
  assert.deepEqual(result, { outcome: 'denied-after-request', asked: true });
  assert.equal(calls.requests, 1);
});

test('permanently denied permission never prompts', async () => {
  __resetStartupPermissionsForTests();
  const calls = { gets: 0, requests: 0 };
  const result = await ensureStartupPermissions({
    platform: 'ios',
    adapter: fakeAdapter({ granted: false, canAskAgain: false }, { granted: true }, calls),
  });
  assert.deepEqual(result, { outcome: 'permanently-denied', asked: false });
  assert.equal(calls.requests, 0);
});

test('adapter errors resolve to an error outcome instead of throwing', async () => {
  __resetStartupPermissionsForTests();
  const result = await ensureStartupPermissions({
    platform: 'ios',
    adapter: {
      getForegroundPermissionsAsync: async () => {
        throw new Error('location services off');
      },
      requestForegroundPermissionsAsync: async () => ({ granted: false }),
    },
  });
  assert.deepEqual(result, { outcome: 'error', asked: false });
});

test('web skips native permission work', async () => {
  __resetStartupPermissionsForTests();
  const calls = { gets: 0, requests: 0 };
  const result = await ensureStartupPermissions({
    platform: 'web',
    adapter: fakeAdapter({ granted: false, canAskAgain: true }, { granted: true }, calls),
  });
  assert.deepEqual(result, { outcome: 'skipped', asked: false });
  assert.equal(calls.gets, 0);
  assert.equal(calls.requests, 0);
});

test('concurrent startup callers share one prompt; later callers reuse the result', async () => {
  __resetStartupPermissionsForTests();
  const calls = { gets: 0, requests: 0 };
  const options = {
    platform: 'ios',
    adapter: fakeAdapter(
      { granted: false, canAskAgain: true },
      { granted: true, canAskAgain: true },
      calls,
    ),
  };
  const [first, second] = await Promise.all([
    ensureStartupPermissions(options),
    ensureStartupPermissions(options),
  ]);
  assert.deepEqual(first, { outcome: 'granted-after-request', asked: true });
  assert.deepEqual(second, first);
  assert.equal(calls.requests, 1);
  const third = await ensureStartupPermissions(options);
  assert.deepEqual(third, first);
  assert.equal(calls.requests, 1);
});
