import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, Script } from 'node:vm';
import ts from 'typescript';

const leaflet = JSON.parse(readFileSync(new URL('../assets/leaflet/bundle.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/lib/openstreetmap-document.ts', import.meta.url), 'utf8');
const context = createContext({ exports: {}, require: () => leaflet });
runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const html = context.exports.OPENSTREETMAP_HTML;
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

function mapHarness() {
  const layers = [], messages = [], bounds = [];
  const map = { attributionControl: { setPosition() {} }, setView() { return this; }, fitBounds(points, options) { bounds.push({ points, options }); }, invalidateSize() {}, getBoundsZoom() { return 2; }, setMinZoom() {}, panInsideBounds() {} };
  const group = () => { const layer = { items: [], addTo() { return this; }, clearLayers() { this.items = []; } }; layers.push(layer); return layer; };
  const item = (coordinates, options) => ({ coordinates, options, addTo(layer) { layer.items.push(this); return this; }, on(event, callback) { this[event] = callback; return this; } });
  const window = { ReactNativeWebView: { postMessage: json => messages.push(JSON.parse(json)) }, addEventListener() {} };
  const document = { createElement: tag => ({ tag, style: {}, children: [], appendChild(child) { this.children.push(child); } }), getElementById: () => ({}) };
  runInContext(scripts[1], createContext({ window, document, Number, ResizeObserver: class { observe() {} }, L: {
    latLngBounds: bounds => bounds, map: () => map, tileLayer: () => ({ addTo() {} }), layerGroup: group,
    marker: item, polyline: item, circleMarker: item, divIcon: options => options,
  } }));
  return { receive: window.free360Receive, layers, messages, bounds };
}

test('map bundles executable Leaflet without remote scripts or Google Maps', () => {
  assert.equal(scripts.length, 2);
  scripts.forEach(script => assert.doesNotThrow(() => new Script(script)));
  assert.ok(!html.includes('<script src='));
  assert.ok(!/googleapis|maps\.google/.test(html));
  assert.ok(html.includes('OpenStreetMap contributors'));
});

test('member text stays inert, unsafe avatars are rejected, taps return the member ID', () => {
  const map = mapHarness();
  assert.deepEqual(map.messages, [{ type: 'ready' }]);
  const malicious = '<img src=x onerror=alert(1)>';
  const member = { id: 'member-1', coordinate: { latitude: 43, longitude: -79 }, name: malicious, initials: malicious, avatar: 'https://attacker.example/avatar', color: '#123456', movement: malicious, description: malicious, battery: 50 };
  map.receive({ type: 'render', data: { members: [member, { ...member, coordinate: { latitude: 91, longitude: 0 } }], homes: [], trail: [], trailColor: '#123456' } });
  assert.equal(map.layers[0].items.length, 1);
  const marker = map.layers[0].items[0];
  const row = marker.options.icon.html;
  assert.equal(row.children[0].children[0].textContent, malicious);
  assert.equal(row.children[0].children[0].children.length, 0);
  assert.equal(row.children[1].textContent, malicious);
  marker.click();
  assert.deepEqual(map.messages[1], { type: 'member', id: 'member-1' });
});

test('trail rendering, clearing, fitting, and recentering preserve map controls', () => {
  const map = mapHarness();
  const coordinates = [{ latitude: 43, longitude: -79 }, { latitude: 44, longitude: -80 }];
  const data = { members: [], homes: [{ name: 'Home', coordinate: coordinates[0] }], trail: coordinates, trailColor: '#123456' };
  map.receive({ type: 'render', data });
  assert.equal(map.layers[0].items.length, 1);
  assert.equal(map.layers[1].items.length, 2);
  map.receive({ type: 'trail', coordinates });
  assert.equal(map.bounds[0].options.paddingBottomRight[1], 330);
  map.receive({ type: 'center', region: { ...coordinates[0], latitudeDelta: .024, longitudeDelta: .024 } });
  assert.equal(map.bounds.length, 2);
  map.receive({ type: 'center', region: { latitude: NaN, longitude: 0 } });
  assert.equal(map.bounds.length, 2);
  map.receive({ type: 'render', data: { ...data, homes: [], trail: [] } });
  assert.equal(map.layers[0].items.length, 0);
  assert.equal(map.layers[1].items.length, 0);
});
