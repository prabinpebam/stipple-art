const test = require('node:test');
const assert = require('node:assert/strict');
const { ParticleField } = require('./particle-field.js');
const view = { zoom: 1, x: 0, y: 0 };

function field(marks = [{ cx: 100, cy: 100 }]) {
  const particles = new ParticleField();
  particles.reset(marks);
  particles.setEnabled(true);
  return particles;
}

test('interaction is off by default and does no idle work', () => {
  const particles = new ParticleField();
  particles.reset([{ cx: 100, cy: 100 }]);
  particles.move(90, 100, 0);
  assert.equal(particles.advance(16, view), false);
  assert.deepEqual([...particles.offsets], [0, 0, 0, 0]);
});

test('cursor fluid moves nearby particles while distant particles stay home', () => {
  const particles = field([{ cx: 100, cy: 100 }, { cx: 500, cy: 500 }]);
  particles.move(80, 100, 0);
  for (let i = 0; i < 30; i++) particles.advance(i * 1000 / 60, view);
  assert.ok(Math.hypot(particles.offsets[0], particles.offsets[1]) > 5);
  assert.equal(particles.offsets[4], 0);
  assert.equal(particles.offsets[5], 0);
});

test('cursor fluid has motion on both axes instead of simple radial repulsion', () => {
  const particles = field();
  particles.move(80, 100, 0);
  for (let i = 0; i < 20; i++) particles.advance(i * 1000 / 60, view);
  assert.ok(Math.abs(particles.offsets[1]) > 0.1);
  assert.ok(Math.abs(particles.offsets[0]) > 0.1);
});

test('cursor directly over a particle never creates NaN or infinity', () => {
  const particles = field();
  particles.move(100, 100, 0);
  for (let i = 0; i < 120; i++) particles.advance(i * 1000 / 60, view);
  assert.ok([...particles.offsets].every(Number.isFinite));
  assert.ok(Math.hypot(particles.offsets[0], particles.offsets[1]) > 0);
});

test('particles settle exactly back home and stop requesting frames', () => {
  const particles = field();
  particles.move(80, 100, 0);
  for (let i = 0; i < 30; i++) particles.advance(i * 1000 / 60, view);
  particles.leave();
  for (let i = 30; i < 1200; i++) particles.advance(i * 1000 / 60, view);
  assert.deepEqual([...particles.offsets], [0, 0, 0, 0]);
  assert.equal(particles.active, false);
});

test('equivalent simulation time at 30 and 60 Hz gives equivalent positions', () => {
  const a = field(), b = field();
  a.move(80, 100, 0);
  b.move(80, 100, 0);
  a.advance(0, view);
  b.advance(0, view);
  for (let i = 1; i <= 60; i++) a.advance(i * 1000 / 60, view);
  for (let i = 1; i <= 30; i++) b.advance(i * 1000 / 30, view);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(a.offsets[i] - b.offsets[i]) < 1e-5);
});

test('large elapsed times are capped and remain stable', () => {
  const particles = field();
  particles.move(100, 100, 0);
  particles.advance(0, view);
  particles.advance(60000, view);
  assert.ok([...particles.offsets].every(Number.isFinite));
  assert.ok(particles.time < 0.1);
});

test('zoom/pan maps cursor fluid center and screen-space radius into world coordinates', () => {
  const a = field(), b = field();
  a.move(80, 100, 0);
  b.move(210, 230, 0);
  const transformed = { zoom: 2, x: 50, y: 30 };
  a.advance(0, view);
  b.advance(0, transformed);
  assert.equal(a.mouseCircle.x, b.mouseCircle.x);
  assert.equal(a.mouseCircle.y, b.mouseCircle.y);
  assert.equal(b.mouseCircle.radius * 2, a.mouseCircle.radius);
  assert.ok([...b.offsets].every(Number.isFinite));
});

test('cursor circle follows input without roaming or expanding to cover distant dots', () => {
  const particles = field([{ cx: 100, cy: 100 }, { cx: 500, cy: 500 }]);
  particles.move(100, 100, 0);
  particles.advance(0, view);
  assert.deepEqual(particles.mouseCircle, { x: 100, y: 100, radius: 180 });
  particles.move(1000, 900, 16);
  for (let i = 1; i <= 60; i++) particles.advance(i * 1000 / 60, view);
  assert.deepEqual(particles.mouseCircle, { x: 1000, y: 900, radius: 180 });
  assert.equal(particles.offsets[4], 0);
  assert.equal(particles.offsets[5], 0);
});

test('cursor over empty space does not keep requesting frames', () => {
  const particles = field();
  particles.move(1000, 1000, 0);
  assert.equal(particles.advance(0, view), false);
  assert.ok(particles.offsets.every(value => value === 0));
  particles.move(100, 100, 16);
  for (let i = 1; i <= 30; i++) particles.advance(i * 1000 / 60, view);
  assert.ok(particles.offsets.some(value => value !== 0));
});

test('disabling cursor fluid leaves global turbulence running', () => {
  const particles = field();
  particles.reset([{ cx: 100, cy: 100 }], { x: 0, y: 0, width: 200, height: 200 });
  particles.setTurbulence(true, 2, 20);
  particles.move(100, 100, 0);
  particles.advance(0, view);
  particles.setMouseEnabled(false);
  assert.equal(particles.mouseFlow, null);
  assert.equal(particles.pointer, null);
  assert.ok(particles.flow);
  assert.equal(particles.advance(16, view), true);
});

test('mouse fluid settings and simulation remain independent of global turbulence controls', () => {
  const a = field(), b = field();
  for (const particles of [a, b]) particles.reset(particles.marks, { x: 0, y: 0, width: 200, height: 200 });
  for (let step = 0; step <= 120; step++) {
    if (step === 0) b.setTurbulence(true, 16, 50);
    if (step === 30) b.setTurbulence(true, 0.5, 0.1);
    if (step === 60) b.setTurbulence(false, 8, 0);
    if (step === 90) b.setTurbulence(true, 4, 20);
    for (const particles of [a, b]) {
      particles.move(80 + Math.sin(step * 0.08) * 20, 100, step * 1000 / 60);
      particles.advance(step * 1000 / 60, view);
    }
  }
  assert.equal(a.mouseFlow.source.frequency, 2);
  assert.equal(b.mouseFlow.source.frequency, 2);
  assert.deepEqual(b.mouseFlow.u, a.mouseFlow.u);
  assert.deepEqual(b.mouseFlow.v, a.mouseFlow.v);
  assert.notDeepEqual(b.offsets, a.offsets);
  assert.equal(b.mouseFlow.gradient, null);
});

test('fixed mouse amplitude converts to world units without following global amplitude', () => {
  for (const zoom of [0.25, 1, 8]) {
    const particles = field();
    particles.setTurbulence(true, 16, 50);
    particles.move(100 * zoom, 100 * zoom, 0);
    particles.advance(0, { ...view, zoom });
    const step = particles.mouseFlow.step.bind(particles.mouseFlow);
    const settings = [];
    particles.mouseFlow.step = (...args) => {
      settings.push({ frequency: args[3], amplitude: args[4] });
      step(...args);
    };
    particles.setTurbulence(true, 0.5, 0.1);
    for (let i = 1; i <= 4; i++) particles.advance(i * 1000 / 60, { ...view, zoom });
    assert.ok(settings.length > 0);
    for (const setting of settings) {
      assert.equal(setting.frequency, 2);
      assert.equal(setting.amplitude * zoom, 20);
    }
  }
});

test('cursor velocity sampling stays local, at 30 Hz, with reusable force storage', () => {
  const particles = field([{ cx: 100, cy: 100 }, { cx: 500, cy: 500 }]);
  particles.move(100, 100, 0);
  particles.advance(0, view);
  const cache = particles.mouseForces, sample = particles.mouseFlow.sample.bind(particles.mouseFlow);
  let queries = 0;
  particles.mouseFlow.sample = (...args) => { queries++; return sample(...args); };
  for (let i = 1; i <= 60; i++) particles.advance(i * 1000 / 60, view);
  assert.ok(queries >= 29 && queries <= 31, `${queries} cursor samples`);
  assert.equal(particles.mouseForces, cache);
  assert.equal(particles.flow, null);
});

test('both fluid fields stay finite and speed-limited at zoom extremes', () => {
  for (const zoom of [0.25, 8]) {
    const particles = field();
    particles.reset(Array.from({ length: 100 }, (_, i) => ({ cx: 40 + i % 10 * 20, cy: 40 + Math.floor(i / 10) * 20 })),
      { x: 0, y: 0, width: 300, height: 300 });
    particles.setTurbulence(true, 16, 50);
    for (let step = 0; step < 120; step++) {
      particles.move((100 + Math.sin(step * 0.1) * 40) * zoom, 100 * zoom, step * 1000 / 60);
      particles.advance(step * 1000 / 60, { ...view, zoom });
    }
    assert.ok(particles.offsets.every(Number.isFinite));
    for (let i = 0; i < particles.marks.length; i++) {
      assert.ok(Math.hypot(particles.offsets[i * 4 + 2], particles.offsets[i * 4 + 3]) <= 1200.001);
    }
    assert.notEqual(particles.mouseForces.buffer, particles.turbulenceForces.buffer);
  }
});

test('disabling restores home without changing the artwork', () => {
  const marks = [{ cx: 100, cy: 100, fillColor: 'red', radius: 2 }];
  const snapshot = JSON.stringify(marks), particles = field(marks);
  particles.move(80, 100, 0);
  particles.advance(0, view);
  particles.setEnabled(false);
  assert.deepEqual([...particles.offsets], [0, 0, 0, 0]);
  assert.equal(JSON.stringify(marks), snapshot);
});

test('new scenes clear old momentum and cursor state', () => {
  const particles = field();
  particles.move(80, 100, 0);
  particles.advance(0, view);
  particles.reset([{ cx: 10, cy: 10 }, { cx: 20, cy: 20 }]);
  assert.equal(particles.offsets.length, 8);
  assert.equal(particles.pointer, null);
  assert.equal(particles.active, false);
});
