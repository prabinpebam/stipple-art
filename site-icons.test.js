const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.webmanifest'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function pngDimensions(file) {
  const data = fs.readFileSync(path.join(__dirname, file));
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

test('home-screen identity and URLs stay inside the GitHub Pages project scope', () => {
  const base = new URL('https://prabinpebam.github.io/stipple-art/site.webmanifest');
  assert.equal(manifest.name, 'Stipple Studio');
  assert.equal(manifest.display, 'standalone');
  for (const key of ['id', 'start_url', 'scope']) {
    assert.equal(new URL(manifest[key], base).href, 'https://prabinpebam.github.io/stipple-art/');
  }
  assert.equal(manifest.theme_color, '#0f766e');
});

test('Android icons include valid 192px, 512px, and maskable PNG assets', () => {
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.equal(pngDimensions(icon.src), icon.sizes);
    assert.ok(new URL(icon.src, 'https://prabinpebam.github.io/stipple-art/').pathname.startsWith('/stipple-art/icons/'));
  }
});

test('favicon fallback and Apple home-screen icon are declared at the right sizes', () => {
  assert.equal(pngDimensions('icons/apple-touch-icon.png'), '180x180');
  assert.equal(pngDimensions('icons/favicon-32.png'), '32x32');
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png" sizes="180x180"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="Stipple Studio"/);
  assert.match(html, /rel="manifest" href="site\.webmanifest"/);
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="icons\/stipple-icon\.svg"/);
});

test('ICO contains complete 16, 32 and 48px PNG entries', () => {
  const data = fs.readFileSync(path.join(__dirname, 'favicon.ico'));
  assert.equal(data.readUInt16LE(0), 0);
  assert.equal(data.readUInt16LE(2), 1);
  assert.equal(data.readUInt16LE(4), 3);
  [16, 32, 48].forEach((size, i) => {
    const entry = 6 + i * 16;
    assert.equal(data[entry], size);
    assert.equal(data[entry + 1], size);
    const length = data.readUInt32LE(entry + 8), offset = data.readUInt32LE(entry + 12);
    assert.ok(offset + length <= data.length);
    assert.deepEqual([...data.subarray(offset, offset + 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(data.readUInt32BE(offset + 16), size);
  });
});

test('stipple motif fits inside the maskable icon circular safe area', () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icons', 'stipple-icon.svg'), 'utf8');
  const circles = [...svg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)];
  assert.equal(circles.length, 9);
  for (const [, x, y, radius] of circles) {
    assert.ok(Math.hypot(Number(x) - 256, Number(y) - 256) + Number(radius) <= 512 * 0.4);
  }
});
