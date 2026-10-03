import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function loadModule(relativePath, exportNames) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
  return mod;
}

const display = await loadModule('../src/lib/member-display.ts');

test('initials derive from saved name the same way for self and others', () => {
  assert.equal(display.initialsForName('Ryan'), 'RY');
  assert.equal(display.initialsForName('Ryan Smith'), 'RS');
  assert.equal(display.initialsForName('  ana   maria  '), 'AM');
  assert.equal(display.initialsForName('Q'), 'Q');
});

test('empty/blank names fall back instead of hardcoded YO', () => {
  assert.equal(display.initialsForName(''), '?');
  assert.equal(display.initialsForName('   '), '?');
  assert.equal(display.initialsForName(null), '?');
  assert.equal(display.initialsForName(undefined), '?');
  assert.notEqual(display.initialsForName('Ryan'), 'YO');
});

test('avatar validation accepts data URIs and rejects invalid/failed photos', () => {
  const valid = `data:image/jpeg;base64,${'a'.repeat(100)}`;
  assert.equal(display.isDisplayableAvatar(valid), true);
  assert.equal(display.avatarUriFor(valid), valid);
  assert.equal(display.isDisplayableAvatar(null), false);
  assert.equal(display.isDisplayableAvatar(''), false);
  assert.equal(display.isDisplayableAvatar('https://example.com/photo.jpg'), false);
  assert.equal(display.isDisplayableAvatar('data:image/jpeg;base64,'), false);
  assert.equal(display.isDisplayableAvatar('not-a-photo'), false);
  assert.equal(display.avatarUriFor('https://example.com/x.jpg'), null);
  assert.equal(display.avatarForProfile({ avatar: valid }), valid);
  assert.equal(display.avatarForProfile({ avatar: 'broken' }), null);
  assert.equal(display.avatarForProfile({}), null);
  assert.equal(display.avatarForProfile(null), null);
});
