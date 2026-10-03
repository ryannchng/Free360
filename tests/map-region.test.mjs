import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/map-region.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const region = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('coordinate validation rejects empty/malformed values', () => {
  assert.equal(region.isValidCoordinate(null), false);
  assert.equal(region.isValidCoordinate(undefined), false);
  assert.equal(region.isValidCoordinate('51,0'), false);
  assert.equal(region.isValidCoordinate({}), false);
  assert.equal(region.isValidCoordinate({ latitude: NaN, longitude: 0 }), false);
  assert.equal(region.isValidCoordinate({ latitude: 91, longitude: 0 }), false);
  assert.equal(region.isValidCoordinate({ latitude: 0, longitude: 181 }), false);
  assert.equal(region.isValidCoordinate({ latitude: '51', longitude: 0 }), false);
  assert.equal(region.isValidCoordinate({ latitude: 51.5, longitude: -0.1 }), true);
});

test('first valid shared location wins; malformed entries skipped', () => {
  assert.deepEqual(region.firstValidCoordinate([]), null);
  assert.deepEqual(region.firstValidCoordinate([null, 'x', {}]), null);
  assert.deepEqual(
    region.firstValidCoordinate([null, { latitude: 91, longitude: 0 }, { latitude: 10, longitude: 20 }, { latitude: 30, longitude: 40 }]),
    { latitude: 10, longitude: 20 },
  );
});

test('center priority: live > shared > home > broad fallback (no location request)', () => {
  const shared = { latitude: 10, longitude: 20 };
  const home = { latitude: 51, longitude: -1 };
  const live = { latitude: 40, longitude: -70 };

  assert.deepEqual(
    region.resolveMapCenter({ currentCoordinate: live, locationEnabled: true, sharedCoordinates: [shared], home }),
    { center: live, source: 'live' },
  );
  // Live coordinate ignored when sharing is off.
  assert.deepEqual(
    region.resolveMapCenter({ currentCoordinate: live, locationEnabled: false, sharedCoordinates: [shared], home }),
    { center: shared, source: 'shared' },
  );
  assert.deepEqual(
    region.resolveMapCenter({ sharedCoordinates: [null, shared], home }),
    { center: shared, source: 'shared' },
  );
  assert.deepEqual(
    region.resolveMapCenter({ sharedCoordinates: [], home }),
    { center: home, source: 'home' },
  );
  const fallback = region.resolveMapCenter({ sharedCoordinates: [null], home: null });
  assert.equal(fallback.source, 'fallback');
  assert.equal(region.isValidCoordinate(fallback.center), true);
});

test('fallback region is broad and renderable; real locations use near delta', () => {
  const fallback = region.resolveInitialRegion({ sharedCoordinates: [], home: null });
  assert.equal(fallback.source, 'fallback');
  assert.ok(fallback.latitudeDelta >= 10 && fallback.longitudeDelta >= 10);
  const near = region.resolveInitialRegion({ sharedCoordinates: [{ latitude: 10, longitude: 20 }] });
  assert.equal(near.source, 'shared');
  assert.equal(near.latitudeDelta, region.MAP_NEAR_DELTA);
  assert.deepEqual(region.regionForCenter({ latitude: 1, longitude: 2 }, 'fallback'), region.MAP_FALLBACK_REGION);
});
