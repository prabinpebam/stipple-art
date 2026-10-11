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

test('nearby particles repel while distant particles stay home', () => {
  const particles = field([{ cx: 100, cy: 100 }, { cx: 500, cy: 500 }]);
  particles.move(80, 100, 0);
  for (let i = 0; i < 30; i++) particles.advance(i * 1000 / 60, view);
  assert.ok(particles.offsets[0] > 20);
  assert.equal(particles.offsets[4], 0);
  assert.equal(particles.offsets[5], 0);
});

test('cursor agitation has a tangential component', () => {
  const particles = field();
  particles.move(80, 100, 0);
  for (let i = 0; i < 20; i++) particles.advance(i * 1000 / 60, view);
  assert.ok(Math.abs(particles.offsets[1]) > 0.1);
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

test('zoom/pan transforms keep interaction radius consistent in screen pixels', () => {
  const a = field(), b = field();
  a.move(80, 100, 0);
  b.move(180, 200, 0);
  const transformed = { zoom: 2, x: 0, y: 0 };
  for (let i = 0; i < 30; i++) {
    a.advance(i * 1000 / 60, view);
    b.advance(i * 1000 / 60, transformed);
  }
  assert.ok(Math.abs(a.offsets[0] - b.offsets[0] * 2) < 1e-4);
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
