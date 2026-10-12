const test = require('node:test');
const assert = require('node:assert/strict');
const { pngSize, svgText } = require('./artwork-export.js');

const scene = {
  width: 800, height: 600, background: 'transparent',
  marks: [
    { cx: 100, cy: 100, radius: 4, opacity: 0.5, fillColor: '#ffffff', vertices: null },
    { cx: 200, cy: 200, radius: 5, opacity: 1, fillColor: 'rgb(1, 2, 3)', vertices: [[195, 195], [205, 195], [200, 205]] }
  ]
};

test('PNG presets preserve logical artwork aspect ratio', () => {
  assert.deepEqual(pngSize(scene, 'original'), { width: 800, height: 600 });
  assert.deepEqual(pngSize(scene, '1024'), { width: 1024, height: 768 });
  assert.deepEqual(pngSize(scene, '2048'), { width: 2048, height: 1536 });
  assert.deepEqual(pngSize(scene, '4096'), { width: 4096, height: 3072 });
  assert.deepEqual(pngSize({ width: 600, height: 800 }, '2048'), { width: 1536, height: 2048 });
});

test('PNG allocations are bounded and unsupported resolutions fail explicitly', () => {
  assert.throws(() => pngSize(scene, '10000'), /supported/);
  assert.throws(() => pngSize(null, '1024'), /No artwork/);
  assert.throws(() => pngSize({ width: 10000, height: 10000 }, 'original'), /too large/);
  const size = pngSize({ width: 10000, height: 10000 }, '4096');
  assert.equal(size.width * size.height, 16777216);
});

test('SVG exports complete original geometry and per-mark opacity without masking', () => {
  const text = svgText(scene);
  assert.match(text, /width="800" height="600" viewBox="0 0 800 600"/);
  assert.match(text, /<circle cx="100" cy="100" r="4" fill="#ffffff" fill-opacity="0.5"/);
  assert.match(text, /<polygon points="195,195 205,195 200,205"/);
  assert.match(text, /fill="transparent"/);
  assert.ok(!text.includes('<mask'));
});

test('exports do not modify cached artwork or include view/particle state', () => {
  const original = JSON.stringify(scene);
  const text = svgText(scene);
  const view = { zoom: 8, x: -200, y: -100, offsets: new Float32Array([100, 100]) };
  assert.equal(svgText(scene, view), text);
  pngSize(scene, '4096');
  assert.equal(JSON.stringify(scene), original);
});

test('SVG rejects missing or empty artwork', () => {
  assert.throws(() => svgText(null), /Generate/);
  assert.throws(() => svgText({ marks: [] }), /Generate/);
});
