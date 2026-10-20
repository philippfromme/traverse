import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real component's asynchronous lifecycle without a network or WebGL context.
class Element {
  constructor() { this.style = {}; this.children = []; this.attributes = {}; this.hidden = false; this.isConnected = true; this.classList = { toggle() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.events ||= {})[name] = callback; }
}
let Heatmap;
globalThis.HTMLElement = Element;
globalThis.document = { createElement: () => new Element() };
globalThis.customElements = { define: (name, component) => { Heatmap = component; } };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.location = { search: '', origin: 'http://localhost' };
globalThis.localStorage = { getItem: () => 'streets' };
class MapStub {
  constructor() { this.events = {}; this.sources = {}; }
  on(event, callback) { this.events[event] = callback; }
  once(event, callback) { this.events[event] = callback; }
  emit(event) { this.events[event]?.(); }
  addSource(name, data) { this.sources[name] = data; }
  addLayer() {}
  remove() { this.removed = true; }
  getCenter() { return [13, 52]; }
  getZoom() { return 5; }
  getPitch() { return 0; }
  getBearing() { return 0; }
}
globalThis.maplibregl = { Map: MapStub };
await import('./public/components/heatmap-map.js');
const data = { features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [13, 52] } }] };
const response = value => ({ ok: true, json: async () => value });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('loading begins before fetch resolves and remains through layer processing until idle', async () => {
  const pending = deferred(); globalThis.fetch = () => pending.promise;
  const map = new Heatmap(); map.connectedCallback();
  assert.equal(map._statusTitle.textContent, 'Loading heatmap…'); assert.equal(map._canvas.attributes['aria-busy'], 'true');
  pending.resolve(response(data)); await settle();
  assert.equal(map._statusTitle.textContent, 'Drawing heatmap…'); assert.equal(map._status.hidden, false);
  map._map.emit('load'); assert.ok(map._map.sources.heatmap); assert.equal(map._status.hidden, false);
  map._map.emit('idle'); assert.equal(map._status.hidden, true); assert.equal(map._canvas.attributes['aria-busy'], 'false');
  map.disconnectedCallback();
});

test('a filter change aborts the previous request and stale responses cannot clear loading', async () => {
  const pending = deferred(); let previousSignal;
  globalThis.fetch = (url, options) => { previousSignal = options.signal; return pending.promise; };
  const map = new Heatmap(); map.connectedCallback();
  globalThis.fetch = async () => response({ features: [] });
  await map.reload('running'); assert.equal(previousSignal.aborted, true);
  assert.equal(map._statusTitle.textContent, 'No activity locations'); assert.equal(map._retry.hidden, true);
  pending.resolve(response(data)); await settle(); assert.equal(map._map, null); assert.equal(map._statusTitle.textContent, 'No activity locations');
  map.disconnectedCallback();
});

test('failed fetch shows a retry action which reloads the selected view and filter', async () => {
  globalThis.fetch = async () => response(data);
  const map = new Heatmap(); map.connectedCallback(); await settle();
  globalThis.fetch = async () => { throw new Error('offline'); };
  await map.reload('cycling', 'tracks');
  assert.equal(map._statusTitle.textContent, 'Tracks could not load'); assert.equal(map._retry.hidden, false); assert.equal(map._canvas.attributes['aria-busy'], 'false');
  let fetched;
  globalThis.fetch = async url => { fetched = url; return response({ bounds: [[0, 0], [10, 10]], rasterMaxZoom: 5, vectorMaxZoom: 12, version: '1' }); };
  await map._retry.events.click(); await settle(); assert.equal(fetched, '/api/tracks');
  map._map.emit('load'); assert.match(map._map.sources['track-raster'].tiles[0], /type=cycling/);
  map._map.emit('idle'); assert.equal(map._status.hidden, true);
  map.disconnectedCallback();
});

test('render errors and map errors replace the spinner with a retry action', async () => {
  globalThis.fetch = async () => response(data);
  const map = new Heatmap(); map.connectedCallback(); await settle();
  map._map.emit('error'); assert.equal(map._retry.hidden, false); assert.equal(map._indicator.hidden, true);
  map._map.addSource = () => { throw new Error('source failed'); };
  map._map.emit('load'); assert.equal(map._statusTitle.textContent, 'Heatmap could not load');
  map.disconnectedCallback();
});

test('an older map becoming idle cannot hide the next filter loading state', async () => {
  globalThis.fetch = async () => response(data);
  const map = new Heatmap(); map.connectedCallback(); await settle();
  const previous = map._map; previous.emit('load');
  const pending = deferred(); globalThis.fetch = () => pending.promise;
  const loading = map.reload('walking');
  previous.emit('idle'); map._onStyleChange();
  assert.equal(map._status.hidden, false); assert.equal(map._statusTitle.textContent, 'Loading heatmap…');
  pending.resolve(response({ features: [] })); await loading;
  assert.equal(map._statusTitle.textContent, 'No activity locations');
  globalThis.fetch = async () => response(data); await map.reload();
  globalThis.fetch = async () => response({ bounds: null }); await map.reload('', 'tracks');
  assert.equal(map._statusTitle.textContent, 'No tracks available');
  map.disconnectedCallback();
});

test('empty tracks settle without a spinner and disconnected callbacks cannot change new loads', async () => {
  const pending = deferred(); globalThis.fetch = () => pending.promise;
  const map = new Heatmap(); map.connectedCallback(); const oldRequest = map._request;
  map.isConnected = false; map.disconnectedCallback(); assert.equal(oldRequest.signal.aborted, true);
  map.isConnected = true; globalThis.fetch = async () => response({ bounds: null });
  location.search = '?view=tracks'; map.connectedCallback(); await settle(); location.search = '';
  assert.equal(map._statusTitle.textContent, 'No tracks available'); assert.equal(map._canvas.attributes['aria-busy'], 'false');
  pending.resolve(response(data)); await settle(); assert.equal(map._statusTitle.textContent, 'No tracks available');
  map.disconnectedCallback();
});
