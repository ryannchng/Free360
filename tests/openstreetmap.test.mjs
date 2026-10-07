import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, Script } from 'node:vm';
import ts from 'typescript';

const leaflet = JSON.parse(readFileSync(new URL('../assets/leaflet/bundle.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/lib/openstreetmap-document.ts', import.meta.url), 'utf8');
const themeContext = createContext({ exports: {} });
runInContext(ts.transpileModule(readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, themeContext);
const batteryContext = createContext({ exports: {} });
runInContext(ts.transpileModule(readFileSync(new URL('../src/lib/battery-display.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, batteryContext);
const context = createContext({ exports: {}, require: path => path === '../theme' ? themeContext.exports : path === './battery-display' ? batteryContext.exports : leaflet });
runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const html = context.exports.OPENSTREETMAP_HTML;
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

function mapHarness(project = () => ({ x: 200, y: 200 })) {
  const layers = [], messages = [], bounds = [];
  const handlers = {};
  const domListeners = {};
  const mapNode = { addEventListener: (type, callback) => { (domListeners[`map:${type}`] ??= []).push(callback); } };
  const map = { id: null, options: null, handlers, attributionControl: { setPosition(position) { this.position = position; }, setPrefix(prefix) { this.prefix = prefix; } }, setView() { return this; }, fitBounds(points, options) { bounds.push({ points, options }); }, invalidateSize() {}, getSize() { return { x: 400, y: 800 }; }, getZoom() { return 15; }, latLngToContainerPoint: project, getBoundsZoom() { return 2; }, setMinZoom() {}, panInsideBounds() {}, on(event, callback) { for (const name of event.split(' ')) (handlers[name] ??= []).push(callback); return this; } };
  const group = () => { const layer = { items: [], addTo() { return this; }, clearLayers() { this.items = []; } }; layers.push(layer); return layer; };
  const item = (coordinates, options) => ({ coordinates, options, addTo(layer) { layer.items.push(this); return this; }, on(event, callback) { this[event] = callback; return this; } });
  const window = { ReactNativeWebView: { postMessage: json => messages.push(JSON.parse(json)) }, addEventListener() {} };
  const element = tag => ({ tag, style: {}, children: [], appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, setAttribute(name, value) { this[name] = value; }, addEventListener(name, callback) { this[name] = callback; } });
  const edges = element('div');
  const attribution = element('div');
  let animationFrame;
  const document = { createElement: element, querySelector: () => attribution, getElementById: id => id === 'edge-markers' ? edges : mapNode, addEventListener: (type, callback) => { (domListeners[`document:${type}`] ??= []).push(callback); } };
  runInContext(scripts[1], createContext({ window, document, Number, requestAnimationFrame: callback => { animationFrame = callback; return 1; }, ResizeObserver: class { observe() {} }, L: {
    latLngBounds: bounds => bounds, map: (id, options) => { map.id = id; map.options = options; return map; }, tileLayer: () => ({ addTo() {} }), layerGroup: group,
    marker: item, polyline: item, circleMarker: item, divIcon: options => options,
  } }));
  const fireMap = (event) => { (handlers[event] ?? []).forEach((callback) => callback()); };
  const fireDom = (target, type) => { (domListeners[`${target}:${type}`] ?? []).forEach((callback) => callback()); };
  return { receive: window.free360Receive, layers, messages, bounds, map, attribution, fireMap, fireDom, edges, flushFrame: () => { animationFrame?.(); animationFrame = null; } };
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
  assert.equal(row.children[0].children[0].textContent, malicious.slice(0, 1));
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

test('pinch zoom anchors at the fingers while bounds and other interactions stay intact', () => {
  const harness = mapHarness();
  const options = harness.map.options;
  // Focal pinch: Leaflet zooms around the midpoint between the two fingers.
  // 'center' would zoom around the map center instead, so an off-center pinch
  // visibly drifts (reported as zooming downward) rather than into the fingers.
  assert.equal(options.touchZoom, true);
  assert.ok(!/touchZoom\s*:\s*['"]center['"]/.test(html));
  assert.match(html, /touchZoom\s*:\s*true/);
  // Narrow scope: wheel and double-tap intentionally stay centered so this
  // change does not alter their existing anchor behavior.
  assert.equal(options.doubleClickZoom, 'center');
  assert.equal(options.scrollWheelZoom, 'center');
  // Pan/zoom bounds and controls are unchanged (compared numerically: the
  // bounds array crosses the vm boundary, so realm prototypes differ).
  assert.equal(options.zoomControl, false);
  assert.equal(options.maxBoundsViscosity, 1);
  assert.equal(options.bounceAtZoomLimits, false);
  assert.equal(options.maxBounds[0][0], -85.0511287798066);
  assert.equal(options.maxBounds[0][1], -180);
  assert.equal(options.maxBounds[1][0], 85.0511287798066);
  assert.equal(options.maxBounds[1][1], 180);
  // The shipped Leaflet still carries the focal branch this config relies on:
  // container-local midpoint -> _pinchStartLatLng, with a 'center' bypass.
  assert.ok(leaflet.js.includes('_pinchStartLatLng'));
  assert.ok(leaflet.js.includes('mouseEventToContainerPoint'));
});

test('focal anchor keeps content under an off-center midpoint, unbiased by viewport offset or centroid moves', () => {
  // Mirrors Leaflet 1.9.4 TouchZoom._onTouchMove focal math at the target zoom:
  //   centerPx = project(pinchStartLatLng) - (midpointContainer - centerPoint)
  // Center-mode instead reuses the map-center latlng and drops the offset,
  // leaving content under the fingers displaced by exactly that offset.
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const focalCenterPx = (pinchStartPx, midpointContainer, centerPoint) =>
    ({ x: pinchStartPx.x - (midpointContainer.x - centerPoint.x), y: pinchStartPx.y - (midpointContainer.y - centerPoint.y) });
  const toContainer = (screen, rect) => ({ x: screen.x - rect.x, y: screen.y - rect.y });
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // Off-center pinch high on a tall phone screen: midpoint 250px above center.
  const centerPoint = { x: 200, y: 400 };
  const pinchStartPx = { x: 1000, y: 1000 };
  const offCenter = { x: 200, y: 150 };
  assert.deepEqual(focalCenterPx(pinchStartPx, offCenter, centerPoint), { x: 1000, y: 1250 });
  // Center-mode would hold the map center fixed, so the geographic point under
  // the fingers ends up 250px away from the fingers: the downward drift.
  const drift = sub(offCenter, centerPoint);
  assert.deepEqual(drift, { x: 0, y: -250 });
  assert.notDeepEqual(focalCenterPx(pinchStartPx, offCenter, centerPoint), pinchStartPx);

  // Viewport offset: the same on-screen fingers map to the same container
  // midpoint only when each touch is resolved container-local (minus the view
  // rect). Raw screen averaging without the rect gives a different answer.
  const rect = { x: 12, y: 96 };
  const touchA = { x: 112, y: 246 };
  const touchB = { x: 212, y: 346 };
  assert.deepEqual(midpoint(toContainer(touchA, rect), toContainer(touchB, rect)), { x: 150, y: 200 });
  assert.notDeepEqual(midpoint(touchA, touchB), { x: 150, y: 200 });

  // Changing centroid: each move re-anchors the original geographic point
  // under the latest midpoint, so a 20px right / 10px down finger slide shifts
  // the anchor center by exactly (-20, -10) in projected pixels.
  const moved = { x: offCenter.x + 20, y: offCenter.y + 10 };
  const before = focalCenterPx(pinchStartPx, offCenter, centerPoint);
  const after = focalCenterPx(pinchStartPx, moved, centerPoint);
  assert.deepEqual(sub(after, before), { x: -20, y: -10 });
});

test('user gestures report interaction; programmatic moves and plain taps do not', () => {
  const interactedCount = (map) => map.messages.filter((message) => message.type === 'interacted').length;
  // Pan: touch, then the drag-driven view event.
  const pan = mapHarness();
  pan.fireDom('map', 'touchstart');
  pan.fireMap('movestart');
  assert.equal(interactedCount(pan), 1);
  // Pinch/wheel zoom: gesture, then the zoom-driven view event.
  const zoom = mapHarness();
  zoom.fireDom('map', 'touchstart');
  zoom.fireMap('zoomstart');
  assert.equal(interactedCount(zoom), 1);
  const wheel = mapHarness();
  wheel.fireDom('map', 'wheel');
  wheel.fireMap('zoomstart');
  assert.equal(interactedCount(wheel), 1);
  // Programmatic fit (no preceding DOM gesture) never counts as interaction.
  const programmatic = mapHarness();
  programmatic.receive({ type: 'center', region: { latitude: 43, longitude: -79, latitudeDelta: 0.024, longitudeDelta: 0.024 } });
  programmatic.fireMap('movestart');
  programmatic.fireMap('zoomstart');
  assert.equal(interactedCount(programmatic), 0);
  // A tap without movement fires no view event, so nothing is reported.
  const tap = mapHarness();
  tap.fireDom('map', 'touchstart');
  assert.equal(interactedCount(tap), 0);
});

test('single-region fits keep the close-zoom bound and clear the overlay areas', () => {
  const map = mapHarness();
  map.receive({ type: 'center', region: { latitude: 43, longitude: -79, latitudeDelta: 0.024, longitudeDelta: 0.024 } });
  assert.equal(map.bounds.length, 1);
  assert.equal(map.bounds[0].options.maxZoom, 17);
  assert.equal(map.bounds[0].options.paddingTopLeft[0], 80);
  assert.equal(map.bounds[0].options.paddingTopLeft[1], 140);
  assert.equal(map.bounds[0].options.paddingBottomRight[0], 80);
  assert.equal(map.bounds[0].options.paddingBottomRight[1], 330);
});

test('stationary members omit the movement badge; moving members keep it with other content intact', () => {
  const map = mapHarness();
  const base = { coordinate: { latitude: 43, longitude: -79 }, name: 'Sam', initials: 'S', avatar: null, color: '#123456', stale: false, battery: 50, description: 'Walking · 18 km/h' };
  map.receive({ type: 'render', data: { members: [{ ...base, id: 'still', movement: '' }, { ...base, id: 'moving', movement: '🚶 ~18 km/h' }], homes: [], trail: [], trailColor: '#123456' } });
  const rows = map.layers[0].items.map((marker) => marker.options.icon.html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children.filter((child) => child.className === 'movement').length, 0);
  // Avatar, initials and battery survive the suppression.
  assert.equal(rows[0].children[0].children[0].textContent, 'S');
  assert.equal(rows[0].children[0].children[1].title, '50% battery');
  assert.equal(rows[0].children[0].children[1].children[0].children[0].style.width, '50%');
  assert.equal(rows[0].children[0].children[1].children[1].textContent, '50%');
  const badges = rows[1].children.filter((child) => child.className === 'movement');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '🚶 ~18 km/h');
});

test('map credit omits Leaflet and follows the panel instead of a fixed CSS offset', () => {
  const harness = mapHarness();
  assert.equal(harness.map.attributionControl.prefix, false);
  assert.equal(harness.map.attributionControl.position, 'bottomleft');
  const css = html.match(/\.leaflet-control-attribution\{([^}]+)\}/g).at(-1);
  assert.ok(!/margin-bottom:[^;]*!important/.test(css));
  for (const inset of [280, 672, 280]) {
    harness.receive({ type: 'render', data: { members: [], homes: [], trail: [], bottomInset: inset } });
    assert.equal(harness.attribution.style.marginBottom, `${inset + 8}px`);
  }
});

test('stay bubble has a purple pin and inert elapsed copy, with no competing speed pill', () => {
  const map = mapHarness();
  const duration = '<img src=x onerror=alert(1)>';
  map.receive({ type: 'render', data: { members: [{ id: 'sam', coordinate: { latitude: 43, longitude: -79 }, name: 'Sam', initials: 'S', color: '#123456', stayDuration: duration, movement: '18 km/h' }], homes: [], trail: [], trailColor: '#123456', bottomInset: 350, topInset: 100 } });
  const row = map.layers[0].items[0].options.icon.html;
  const bubble = row.children.find(child => child.className === 'stay');
  assert.ok(bubble.children[0].innerHTML.includes('<svg'));
  assert.equal(bubble.children[1].children[0].textContent, 'Here for');
  assert.equal(bubble.children[1].children[1].textContent, duration);
  assert.equal(bubble.children[1].children[1].children.length, 0);
  assert.ok(!row.children.some(child => child.className === 'movement'));
  map.receive({ type: 'center', region: { latitude: 43, longitude: -79, latitudeDelta: .024, longitudeDelta: .024 } });
  assert.equal(map.bounds[0].options.paddingBottomRight[1], 394);
});

test('edge avatars follow offscreen members, clear when visible and open the correct member', () => {
  let projection = { x: 600, y: 250 };
  const map = mapHarness(() => projection);
  const member = { id: 'sam', coordinate: { latitude: 43, longitude: -79 }, name: 'Sam', initials: 'SA', color: '#007F6B' };
  map.receive({ type: 'render', data: { members: [member], homes: [], trail: [], trailColor: '#123456', bottomInset: 340, topInset: 80 } });
  map.flushFrame();
  assert.equal(map.edges.children.length, 1);
  const edge = map.edges.children[0];
  assert.equal(edge.textContent, 'S');
  assert.equal(edge.style.left, '362px');
  assert.ok(parseFloat(edge.style.top) < 402);
  edge.click();
  assert.deepEqual(map.messages.at(-1), { type: 'member', id: 'sam' });
  assert.equal(map.bounds.at(-1).options.maxZoom, 15);
  projection = { x: 200, y: 200 };
  map.fireMap('move'); map.flushFrame();
  assert.equal(map.edges.children.length, 0);
  projection = { x: 200, y: 700 };
  map.fireMap('resize'); map.flushFrame();
  assert.equal(map.edges.children.length, 1);
  assert.equal(map.edges.children[0].style.top, '384px');
});

test('only the highlighted member gets a stay bubble and is drawn above nearby avatars', () => {
  const map = mapHarness();
  const base = { coordinate: { latitude: 43, longitude: -79 }, initials: 'S', color: '#007F6B', stayDuration: '5 hrs' };
  map.receive({ type: 'render', data: { members: [{ ...base, id: 'self', name: 'Sam' }, { ...base, id: 'selected', name: 'Alex' }], homes: [], trail: [], trailColor: '#123456', highlightedMemberId: 'selected' } });
  const markers = map.layers[0].items;
  assert.ok(!markers[0].options.icon.html.children.some(child => child.className === 'stay'));
  assert.ok(markers[1].options.icon.html.children.some(child => child.className === 'stay'));
  assert.equal(markers[0].options.zIndexOffset, 0);
  assert.equal(markers[1].options.zIndexOffset, 500);
});

test('battery numbers sit inside the icon, change color at thresholds and omit unavailable readings', () => {
  const map = mapHarness();
  const levels = [0, 20, 21, 50, 51, 100, null, -1, NaN, '35'];
  const base = { coordinate: { latitude: 43, longitude: -79 }, initials: 'S', name: 'Sam', color: '#007F6B' };
  map.receive({ type: 'render', data: { members: levels.map((battery, index) => ({ ...base, id: String(index), battery })), homes: [], trail: [], trailColor: '#123456' } });
  const markers = map.layers[0].items;
  for (let index = 0; index < 6; index++) {
    const battery = markers[index].options.icon.html.children[0].children[1];
    assert.equal(battery.children[1].textContent, `${levels[index]}%`);
    assert.equal(battery.children[0].children[0].style.width, `${levels[index]}%`);
    assert.equal(battery.style.color, index < 2 ? '#D92D42' : index < 4 ? '#C06B16' : '#178347');
  }
  for (let index = 6; index < levels.length; index++) {
    assert.equal(markers[index].options.icon.html.children[0].children.length, 1);
  }
  assert.equal(markers[0].options.icon.iconSize[0], 58);
});
