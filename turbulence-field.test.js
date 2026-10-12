const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TurbulenceField } = require('./turbulence-field.js');
const { ParticleField } = require('./particle-field.js');
const bounds = { x: 0, y: 0, width: 800, height: 600 };
const view = { zoom: 1, x: 0, y: 0, width: 800, height: 600 };

function flow(frequency = 2) {
  const field = new TurbulenceField();
  field.configure(bounds, frequency);
  field.update(0);
  return field;
}

function particles(amplitude = 1, frequency = 2) {
  const field = new ParticleField();
  field.reset(Array.from({ length: 100 }, (_, i) => ({ cx: 150 + (i % 10) * 30, cy: 100 + Math.floor(i / 10) * 30 })), bounds);
  field.setMouseEnabled(false);
  field.setTurbulence(true, frequency, amplitude);
  field.setEnabled(true);
  return field;
}

test('turbulence defaults off without allocating or building a field', () => {
  const field = new ParticleField();
  assert.equal(field.turbulence.enabled, false);
  assert.equal(field.turbulence.amplitude, 20);
  assert.equal(field.turbulence.frequency, 10);
  assert.equal(field.flow, null);
  assert.equal(field.advance(0, view), false);
});

test('turbulence sliders expose expanded ranges in 0.1 steps with physics defaults', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const slider = html.match(/<input\b[^>]*\bid="turbulenceAmplitude"[^>]*>/);
  assert.ok(slider);
  assert.match(slider[0], /\bmin="0"/);
  assert.match(slider[0], /\bmax="50"/);
  assert.match(slider[0], /\bstep="0.1"/);
  assert.match(slider[0], new RegExp(`\\bvalue="${new ParticleField().turbulence.amplitude}"`));
  assert.match(html, /id="turbulenceAmplitudeVal">20<\/output>/);
  const frequency = html.match(/<input\b[^>]*\bid="turbulenceFrequency"[^>]*>/);
  assert.ok(frequency);
  assert.match(frequency[0], /\bmin="0.5"/);
  assert.match(frequency[0], /\bmax="16"/);
  assert.match(frequency[0], /\bstep="0.1"/);
  assert.match(frequency[0], new RegExp(`\\bvalue="${new ParticleField().turbulence.frequency}"`));
  assert.match(html, /id="turbulenceFrequencyVal">10<\/output>/);
});

test('fractional amplitudes produce distinct low-strength motion without rounding', () => {
  const low = particles(0.1), high = particles(0.2);
  for (let i = 0; i <= 60; i++) {
    low.advance(i * 1000 / 60, view);
    high.advance(i * 1000 / 60, view);
  }
  assert.equal(low.turbulence.amplitude, 0.1);
  assert.equal(high.turbulence.amplitude, 0.2);
  const energy = field => field.offsets.reduce((sum, value, index) => sum + (index % 4 < 2 ? value * value : 0), 0);
  assert.ok(energy(low) > 0);
  assert.ok(energy(high) > energy(low) * 2);
});

test('coherent field is deterministic, bounded and smoothly interpolated', () => {
  const a = flow(), b = flow();
  const start = [...a.sample(333, 244)];
  assert.deepEqual([...b.sample(333, 244)], start);
  assert.ok(Math.hypot(...start) <= 1.001);
  const nearby = [...a.sample(333.001, 244.001)];
  assert.ok(Math.hypot(start[0] - nearby[0], start[1] - nearby[1]) < 0.001);
  a.update(0.001);
  const next = [...a.sample(333, 244)];
  assert.ok(Math.hypot(start[0] - next[0], start[1] - next[1]) < 0.01);
});

test('frequency changes spatial swirl density rather than particle allocation', () => {
  const low = flow(0.5), high = flow(16);
  let lowVariation = 0, highVariation = 0;
  let previousLow = [...low.sample(0, 250)], previousHigh = [...high.sample(0, 250)];
  for (let x = 5; x <= 800; x += 5) {
    const nextLow = [...low.sample(x, 250)], nextHigh = [...high.sample(x, 250)];
    lowVariation += Math.hypot(nextLow[0] - previousLow[0], nextLow[1] - previousLow[1]);
    highVariation += Math.hypot(nextHigh[0] - previousHigh[0], nextHigh[1] - previousHigh[1]);
    previousLow = nextLow;
    previousHigh = nextHigh;
  }
  assert.ok(highVariation > lowVariation * 2, `${highVariation} vs ${lowVariation}`);
  assert.equal(low.current.length, high.current.length);
});

test('grid and sample buffers are reused across particle queries', () => {
  const field = flow();
  const first = field.sample(10, 10);
  assert.equal(field.sample(100, 100), first);
  const current = field.current, next = field.next;
  field.update(0.01);
  assert.equal(field.current, current);
  assert.equal(field.next, next);
  field.update(1 / 30);
  assert.equal(field.current, next);
  assert.equal(field.next, current);
});

test('field updates never sample non-finite values at or beyond image edges', () => {
  const field = flow(16);
  for (const [x, y] of [[0, 0], [800, 600], [-100, -100], [1000, 1000]]) {
    assert.ok([...field.sample(x, y)].every(Number.isFinite));
  }
});

test('turbulence animates without a mouse and stronger amplitude creates larger motion', () => {
  const low = particles(5), high = particles(50);
  for (let i = 0; i <= 60; i++) {
    low.advance(i * 1000 / 60, view);
    high.advance(i * 1000 / 60, view);
  }
  const energy = field => field.offsets.reduce((sum, value, index) => sum + (index % 4 < 2 ? value * value : 0), 0);
  assert.ok(energy(low) > 0.1);
  assert.ok(energy(high) > energy(low) * 5);
  assert.equal(low.active, true);
  const before = [...low.offsets];
  for (let i = 61; i <= 240; i++) low.advance(i * 1000 / 60, view);
  assert.notDeepEqual([...low.offsets], before);
});

test('zero amplitude or turbulence off returns home and stops frames', () => {
  for (const enabled of [true, false]) {
    const field = particles();
    for (let i = 0; i < 60; i++) field.advance(i * 1000 / 60, view);
    field.setTurbulence(enabled, 2, 0);
    for (let i = 60; i < 7260 && field.active; i++) field.advance(i * 1000 / 60, view);
    assert.ok(field.offsets.every(value => value === 0));
    assert.equal(field.active, false);
    assert.equal(field.flow, null);
  }
});

test('cursor forces add to turbulence without changing home geometry or colors', () => {
  const a = particles(), b = particles();
  const original = JSON.stringify(b.marks);
  b.setMouseEnabled(true);
  b.move(150, 100, 0);
  for (let i = 0; i < 60; i++) {
    a.advance(i * 1000 / 60, view);
    b.advance(i * 1000 / 60, view);
  }
  assert.notDeepEqual([...a.offsets], [...b.offsets]);
  assert.equal(JSON.stringify(b.marks), original);
  assert.ok(b.offsets.every(Number.isFinite));
});

test('extreme slider values remain finite with capped catch-up', () => {
  const field = particles(50, 16);
  field.advance(0, view);
  field.advance(60000, { ...view, zoom: 8, x: -1000, y: -1000 });
  assert.ok(field.offsets.every(Number.isFinite));
  assert.ok(field.time < 0.1);
});

test('invalid field configuration fails explicitly', () => {
  assert.throws(() => flow(NaN), /frequency/);
  assert.throws(() => flow(16.1), /frequency/);
  const field = particles();
  assert.throws(() => field.setTurbulence(true, 16.1, 20), /frequency/);
  assert.throws(() => field.setTurbulence(true, 2, -1), /amplitude/);
});

test('particle forces are sampled at field rate, not every physics step', () => {
  const field = particles();
  field.advance(0, view);
  const cache = field.turbulenceForces;
  const sample = field.flow.sample.bind(field.flow);
  let queries = 0;
  field.flow.sample = (...args) => { queries++; return sample(...args); };
  for (let i = 1; i <= 60; i++) field.advance(i * 1000 / 60, view);
  assert.ok(queries >= field.marks.length * 25 && queries <= field.marks.length * 31, `${queries} queries`);
  assert.equal(field.turbulenceForces, cache);
});
