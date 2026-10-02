import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/home-transition.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { homeTransition, isInsideHome } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('first OS callback establishes a baseline without claiming an arrival', () => {
  assert.equal(homeTransition(undefined, true, 1000).notify, false);
  assert.equal(homeTransition(undefined, false, 1000).notify, false);
});
test('stable entry and exit notify; duplicate callbacks and boundary chatter do not', () => {
  const outside = { inside: false, at: 1000 };
  assert.equal(homeTransition(outside, true, 121000).notify, true);
  assert.equal(homeTransition({ inside: true, at: 1000 }, false, 121000).notify, true);
  assert.equal(homeTransition(outside, false, 500000).notify, false);
  assert.equal(homeTransition(outside, true, 5000).notify, false);
});
test('home radius uses metres and works across the date line', () => {
  const home = { latitude: 0, longitude: 0, radius: 150 };
  assert.equal(isInsideHome(home, { latitude: 0, longitude: 0.001 }), true);
  assert.equal(isInsideHome(home, { latitude: 0, longitude: 0.002 }), false);
  assert.equal(isInsideHome({ ...home, longitude: 179.9995 }, { latitude: 0, longitude: -179.9995 }), true);
});
