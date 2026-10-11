const test = require('node:test');
const assert = require('node:assert/strict');
const { visibleBounds, isVisible, PreviewRenderer } = require('./preview-renderer.js');

test('visible bounds invert the zoom and pan transform', () => {
  assert.deepEqual(visibleBounds({ zoom: 2, x: -200, y: -100 }, 800, 600),
    { left: 100, top: 50, right: 500, bottom: 350 });
});

test('marks whose centers are off-screen remain visible when their radius overlaps', () => {
  const bounds = { left: 100, top: 100, right: 200, bottom: 200 };
  for (const [cx, cy] of [[95, 150], [205, 150], [150, 95], [150, 205]]) {
    assert.ok(isVisible({ cx, cy, radius: 5 }, bounds));
    assert.ok(!isVisible({ cx, cy, radius: 4 }, bounds));
  }
});

test('culling includes the entire polygon circumradius', () => {
  assert.ok(isVisible({ cx: 210, cy: 150, radius: 12 },
    { left: 100, top: 100, right: 200, bottom: 200 }));
});

test('zoom changes the visible subset without changing mark geometry', () => {
  const marks = [{ cx: 50, cy: 50, radius: 2 }, { cx: 750, cy: 550, radius: 2 }];
  const original = JSON.stringify(marks);
  const full = visibleBounds({ zoom: 1, x: 0, y: 0 }, 800, 600);
  const detail = visibleBounds({ zoom: 8, x: 0, y: 0 }, 800, 600);
  assert.equal(marks.filter(mark => isVisible(mark, full)).length, 2);
  assert.equal(marks.filter(mark => isVisible(mark, detail)).length, 1);
  assert.equal(JSON.stringify(marks), original);
});

test('Canvas fallback caches paths, preserves painter order and culls during navigation', t => {
  const originalPath = globalThis.Path2D;
  let pathCount = 0;
  globalThis.Path2D = class {
    constructor() { this.id = pathCount++; }
    arc() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
  t.after(() => {
    if (originalPath === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = originalPath;
  });
  t.mock.method(console, 'warn', () => {});
  const draws = [], transforms = [];
  const translations = [];
  const context = {
    setTransform(...values) { transforms.push(values); },
    clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {},
    translate(x, y) { translations.push([x, y]); },
    fillRect() {}, restore() {},
    fill(path) { draws.push({ path: path.id, color: this.fillStyle }); }
  };
  const canvas = { getContext(type) { return type === '2d' ? context : null; } };
  const renderer = new PreviewRenderer(canvas);
  renderer.resize(800, 600, 2);
  const marks = [
    { cx: 50, cy: 50, radius: 10, fillColor: 'red' },
    { cx: 50, cy: 50, radius: 5, fillColor: 'blue' },
    { cx: 750, cy: 550, radius: 10, fillColor: 'green' }
  ];
  const scene = { width: 800, height: 600, background: 'white', marks };
  renderer.setScene(scene);
  renderer.render({ zoom: 1, x: 0, y: 0 });
  assert.deepEqual(draws.map(draw => draw.color), ['red', 'blue', 'green']);
  draws.length = 0;
  renderer.render({ zoom: 8, x: 0, y: 0 });
  assert.deepEqual(draws.map(draw => draw.color), ['red', 'blue']);
  assert.equal(pathCount, 3);
  assert.deepEqual(transforms.at(-1), [16, 0, 0, 16, 0, 0]);
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 1200);
  assert.equal(renderer.scene, scene);
  draws.length = 0;
  const offsets = new Float32Array(12);
  offsets[8] = -700;
  offsets[9] = -500;
  renderer.render({ zoom: 8, x: 0, y: 0 }, offsets);
  assert.deepEqual(draws.map(draw => draw.color), ['red', 'blue', 'green']);
  assert.deepEqual(translations, [[-700, -500], [700, 500]]);
  assert.equal(pathCount, 3);
  renderer.resize(800, 600, 1);
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  assert.equal(pathCount, 3);
});
