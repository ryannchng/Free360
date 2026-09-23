import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import WebSocket from 'ws';

const port = 20000 + Math.floor(Math.random() * 30000);
const relayUrl = `ws://127.0.0.1:${port}/ws`;
const circleId = 'test_circle_123456';
const ownerId = 'test_owner_123456';

function connect() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(relayUrl);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function request(socket, type, payload = {}) {
  return new Promise((resolve, reject) => {
    const requestId = `test_${Math.random()}`;
    const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error('Relay request timed out')); }, 3000);
    const listener = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.requestId !== requestId) return;
      clearTimeout(timeout);
      socket.off('message', listener);
      if (message.type === 'error') reject(new Error(message.message));
      else resolve(message);
    };
    socket.on('message', listener);
    socket.send(JSON.stringify({ type, requestId, ...payload }));
  });
}

test('replays encrypted check-ins and latest paused snapshot after reconnect', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'free360-relay-test-'));
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), RELAY_DATA_PATH: join(directory, 'state.json') },
    stdio: 'ignore',
  });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (response.ok) { healthy = true; break; }
      } catch { /* startup */ }
      await delay(100);
    }
    assert.ok(healthy, 'relay started');

    const owner = await connect();
    const created = await request(owner, 'create_circle', { circleId, deviceId: ownerId });
    const invite = await request(owner, 'create_invite');
    const member = await connect();
    const joined = await request(member, 'claim_invite', { circleId, inviteId: invite.inviteId, deviceId: 'test_member_123456' });
    assert.ok(joined.deviceToken);

    const location = { version: 1, nonce: 'opaque-location', ciphertext: 'encrypted-location' };
    const checkIn = { version: 1, nonce: 'opaque-event', ciphertext: 'encrypted-checkin' };
    const paused = { version: 1, nonce: 'opaque-paused', ciphertext: 'encrypted-paused' };
    await request(owner, 'publish', { envelope: location });
    await request(owner, 'publish_event', { envelope: checkIn });
    await request(owner, 'publish', { envelope: paused });

    const replay = await request(member, 'authenticate', { circleId, deviceId: 'test_member_123456', deviceToken: joined.deviceToken });
    assert.equal(replay.snapshots.length, 1);
    assert.deepEqual(replay.snapshots[0].envelope, paused);
    assert.equal(replay.events.length, 1);
    assert.deepEqual(replay.events[0].envelope, checkIn);
    assert.equal(replay.events[0].senderDeviceId, ownerId);
    assert.ok(created.deviceToken);
    owner.close();
    member.close();
  } finally {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
