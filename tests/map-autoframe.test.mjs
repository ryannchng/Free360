import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadModule(relativePath, localRequire) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', 'require', javascript)(module.exports, module, localRequire);
  return module.exports;
}

const region = loadModule('../src/lib/map-region.ts', require);
const autoframe = loadModule('../src/lib/map-autoframe.ts', (path) => {
  if (path === './map-region') return region;
  return require(path);
});

const ready = { ready: true, members: [], trail: [] };
const SF = { latitude: 37.77, longitude: -122.41 };
const NYC = { latitude: 40.71, longitude: -74.0 };

test('not ready never moves the view', () => {
  const decided = autoframe.decideViewCommand(autoframe.initialAutoFrameState, { ready: false, members: [SF], trail: [] });
  assert.deepEqual(decided.command, { kind: 'none' });
  assert.deepEqual(decided.state, autoframe.initialAutoFrameState);
});

test('initial framing fits all members once; routine updates inside the fit do not reset', () => {
  let state = autoframe.initialAutoFrameState;
  let decided = autoframe.decideViewCommand(state, { ...ready, members: [] });
  assert.deepEqual(decided.command, { kind: 'none' });
  state = decided.state;
  decided = autoframe.decideViewCommand(state, { ...ready, members: [SF, NYC] });
  assert.equal(decided.command.kind, 'center');
  assert.ok(decided.command.region.longitudeDelta > 10);
  assert.ok(decided.command.region.latitudeDelta >= 2.94);
  state = decided.state;
  // Small jitter from a routine location update stays inside the fitted view.
  const jittered = [
    { latitude: SF.latitude + 0.001, longitude: SF.longitude },
    { latitude: NYC.latitude, longitude: NYC.longitude + 0.001 },
  ];
  decided = autoframe.decideViewCommand(state, { ...ready, members: jittered });
  assert.deepEqual(decided.command, { kind: 'none' });
  assert.deepEqual(decided.state, state);
});

test('a member leaving the fitted view refits; shrink does not reset', () => {
  let state = autoframe.initialAutoFrameState;
  state = autoframe.decideViewCommand(state, { ...ready, members: [SF] }).state;
  const far = { latitude: 51.5, longitude: -0.1 };
  const refit = autoframe.decideViewCommand(state, { ...ready, members: [SF, far] });
  assert.equal(refit.command.kind, 'center');
  state = refit.state;
  // Everyone leaves except one member still inside the widened view: no reset.
  const shrink = autoframe.decideViewCommand(state, { ...ready, members: [SF] });
  assert.deepEqual(shrink.command, { kind: 'none' });
  assert.deepEqual(shrink.state, state);
});

test('manual interaction suspends auto-framing until the recenter control resumes it', () => {
  let state = autoframe.initialAutoFrameState;
  state = autoframe.decideViewCommand(state, { ...ready, members: [SF] }).state;
  state = autoframe.markInteracted(state);
  const held = autoframe.decideViewCommand(state, { ...ready, members: [SF, NYC] });
  assert.deepEqual(held.command, { kind: 'none' });
  state = autoframe.requestFitGroup(held.state);
  const refit = autoframe.decideViewCommand(state, { ...ready, members: [SF, NYC] });
  assert.equal(refit.command.kind, 'center');
  assert.equal(refit.state.autoFrame, true);
});

test('trail view fits once, suspends framing, and restores the prior mode on hide', () => {
  const trail = [SF, { latitude: 38, longitude: -122 }, NYC];
  let state = autoframe.initialAutoFrameState;
  state = autoframe.decideViewCommand(state, { ...ready, members: [SF] }).state;
  const shown = autoframe.decideViewCommand(state, { ...ready, members: [SF], trail });
  assert.equal(shown.command.kind, 'trail');
  assert.equal(shown.state.autoFrame, false);
  state = shown.state;
  // Trail refreshes and member updates while the trail is shown do not refit.
  const steady = autoframe.decideViewCommand(state, { ...ready, members: [SF, NYC], trail });
  assert.deepEqual(steady.command, { kind: 'none' });
  // Hiding the trail returns to the group view because framing was active before.
  const hidden = autoframe.decideViewCommand(steady.state, { ...ready, members: [SF, NYC], trail: [] });
  assert.equal(hidden.command.kind, 'center');
  assert.equal(hidden.state.autoFrame, true);
  // Manual mode survives a trail detour: no refit on hide.
  let manual = autoframe.markInteracted(autoframe.initialAutoFrameState);
  manual = autoframe.decideViewCommand(manual, { ...ready, members: [SF], trail }).state;
  const backToManual = autoframe.decideViewCommand(manual, { ...ready, members: [SF, NYC], trail: [] });
  assert.deepEqual(backToManual.command, { kind: 'none' });
  assert.equal(backToManual.state.autoFrame, false);
});
