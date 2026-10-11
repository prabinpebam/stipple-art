const test = require('node:test');
const assert = require('node:assert/strict');
const { zoomAt, constrain, MIN_ZOOM, MAX_ZOOM, PreviewViewport } = require('./preview-viewport.js');

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
}

test('zoom keeps the artwork coordinate under the cursor stationary', () => {
  const view = { zoom: 1.5, x: -120, y: -60 };
  const anchor = { x: 250, y: 180 };
  const next = zoomAt(view, 3, anchor);
  near((anchor.x - next.x) / next.zoom, (anchor.x - view.x) / view.zoom);
  near((anchor.y - next.y) / next.zoom, (anchor.y - view.y) / view.zoom);
});

test('zoom clamps to 25%-800% before computing anchor offsets', () => {
  const view = { zoom: 1, x: 0, y: 0 };
  const anchor = { x: 100, y: 50 };
  const maximum = zoomAt(view, 100, anchor);
  const minimum = zoomAt(view, 0.001, anchor);
  assert.equal(maximum.zoom, MAX_ZOOM);
  assert.equal(minimum.zoom, MIN_ZOOM);
  near(maximum.x, anchor.x * (1 - MAX_ZOOM));
  near(minimum.y, anchor.y * (1 - MIN_ZOOM));
});

test('zooming in then out at the same anchor restores the view', () => {
  const view = { zoom: 1, x: 0, y: 0 };
  const anchor = { x: 420, y: 210 };
  const restored = zoomAt(zoomAt(view, 4, anchor), 1, anchor);
  assert.deepEqual(restored, view);
});

test('zoom at the limit does not move an already-zoomed view', () => {
  const view = { zoom: MAX_ZOOM, x: -350, y: -220 };
  assert.deepEqual(zoomAt(view, 20, { x: 90, y: 120 }), view);
});

test('pan bounds keep a zoomed canvas covering the viewport', () => {
  assert.deepEqual(constrain({ zoom: 2, x: -2000, y: 100 }, 800, 600),
    { zoom: 2, x: -800, y: 0 });
  assert.deepEqual(constrain({ zoom: 2, x: 100, y: -2000 }, 800, 600),
    { zoom: 2, x: 0, y: -600 });
});

test('zoomed-out canvas remains inside the viewport', () => {
  assert.deepEqual(constrain({ zoom: 0.5, x: -200, y: 900 }, 800, 600),
    { zoom: 0.5, x: 0, y: 300 });
});

test('valid centered zoom-out offsets remain unchanged', () => {
  const view = { zoom: 0.5, x: 200, y: 150 };
  assert.deepEqual(constrain(view, 800, 600), view);
});

test('fit view cannot be panned off-screen', () => {
  assert.deepEqual(constrain({ zoom: 1, x: 500, y: -300 }, 800, 600),
    { zoom: 1, x: 0, y: 0 });
});

test('pinch zoom supports simultaneous midpoint translation', () => {
  const start = { zoom: 1, x: 0, y: 0 };
  const before = { x: 300, y: 250 }, after = { x: 330, y: 290 };
  const next = zoomAt(start, 2, before);
  next.x += after.x - before.x;
  next.y += after.y - before.y;
  near((after.x - next.x) / next.zoom, before.x);
  near((after.y - next.y) / next.zoom, before.y);
});

test('navigation math leaves its input unchanged', () => {
  const view = { zoom: 2, x: -120, y: -240 };
  const snapshot = { ...view };
  zoomAt(view, 4, { x: 400, y: 300 });
  constrain(view, 800, 600);
  assert.deepEqual(view, snapshot);
});

test('zoom, pan, and fit bursts coalesce into one draw of the latest view', t => {
  const original = globalThis.requestAnimationFrame;
  const callbacks = [];
  globalThis.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
  t.after(() => {
    if (original === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = original;
  });
  const viewport = Object.create(PreviewViewport.prototype);
  Object.assign(viewport, {
    width: 800, height: 600, enabled: true, frame: null,
    view: { zoom: 1, x: 0, y: 0 }, pointers: new Map(),
    stage: { classList: { remove() {} } },
    out: {}, into: {}, fit: {}, output: {}
  });
  const drawn = [];
  viewport.draw = view => drawn.push({ ...view });
  for (let i = 0; i < 100; i++) {
    viewport.zoomBy(1.25);
    viewport.pan(-20, -10);
    viewport.reset();
  }
  assert.equal(callbacks.length, 1);
  assert.equal(drawn.length, 0);
  callbacks.shift()();
  assert.deepEqual(drawn, [{ zoom: 1, x: 0, y: 0 }]);
  assert.equal(viewport.frame, null);
  viewport.zoomBy(2);
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.equal(drawn.length, 2);
  assert.equal(drawn[1].zoom, 2);
  assert.equal(viewport.output.value, '200%');
});
