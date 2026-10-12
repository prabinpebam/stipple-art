const test = require('node:test');
const assert = require('node:assert/strict');
const { FluidPatch, influence, homeAttraction, rotatingGradient, gradientWeight, GRADIENT_PERIOD, N, STRIDE } = require('./fluid-patch.js');
const { ParticleField } = require('./particle-field.js');
const bounds = { x: 0, y: 0, width: 800, height: 600 };
const view = { zoom: 1, x: 0, y: 0, width: 800, height: 600 };
const marks = Array.from({ length: 400 }, (_, i) => ({ cx: (i % 20) * 40 + 20, cy: Math.floor(i / 20) * 30 + 15 }));

test('rotating gradient spans zero to maximum inside offset, non-square image bounds', () => {
  const image = { x: 120, y: 80, width: 320, height: 180 };
  const corners = [[120, 80], [440, 80], [120, 260], [440, 260]];
  for (let time = 0; time < GRADIENT_PERIOD; time += 0.5) {
    const gradient = rotatingGradient(image, time);
    const values = corners.map(([x, y]) => gradientWeight(gradient, x, y));
    assert.ok(Math.min(...values) < 1e-12);
    assert.ok(Math.max(...values) > 1 - 1e-12);
    assert.ok(Math.abs(gradientWeight(gradient, 280, 170) - 19 / 343) < 1e-12);
    assert.equal(gradientWeight(gradient, 119, 170), 0);
    assert.equal(gradientWeight(gradient, 441, 170), 0);
    assert.equal(gradientWeight(gradient, 280, 79), 0);
    assert.equal(gradientWeight(gradient, 280, 261), 0);
    for (let y = 80; y <= 260; y += 30) {
      for (let x = 120; x <= 440; x += 40) {
        const value = gradientWeight(gradient, x, y);
        assert.ok(value >= 0 && value <= 1);
      }
    }
  }
  assert.throws(() => rotatingGradient({ ...image, width: 0 }, 0), /gradient bounds/);
  assert.throws(() => rotatingGradient(image, NaN), /gradient bounds/);
});

test('gradient follows softened inverse-square falloff rather than a linear ramp', () => {
  const gradient = rotatingGradient(bounds, 0);
  const weightAtDistance = distance => gradientWeight(gradient, bounds.width * (1 - distance), 300);
  assert.equal(weightAtDistance(0), 1);
  assert.equal(weightAtDistance(1), 0);
  assert.ok(Math.abs(weightAtDistance(0.5) - 19 / 343) < 1e-12);
  // Removing the endpoint offset exposes a fourfold drop when softened distance doubles.
  const ratio = (weightAtDistance(0.2) + 1 / 35) / (weightAtDistance(0.6) + 1 / 35);
  assert.ok(Math.abs(ratio - 4) < 1e-12);
  let previous = 1;
  for (let distance = 0; distance <= 1; distance += 0.01) {
    const weight = weightAtDistance(distance);
    assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= previous);
    previous = weight;
  }
});

test('gradient rotates smoothly through all directions in sixty seconds', () => {
  assert.equal(GRADIENT_PERIOD, 60);
  const left = time => gradientWeight(rotatingGradient(bounds, time), 0, 300);
  const top = time => gradientWeight(rotatingGradient(bounds, time), 400, 0);
  assert.equal(left(0), 0);
  assert.ok(Math.abs(top(15)) < 1e-12);
  assert.ok(Math.abs(left(30) - 1) < 1e-12);
  assert.ok(Math.abs(top(45) - 1) < 1e-12);
  assert.equal(left(60), left(0));
  for (let time = 0; time < 60; time += 0.5) {
    const value = gradientWeight(rotatingGradient(bounds, time), 150, 100);
    const next = gradientWeight(rotatingGradient(bounds, time + 1 / 30), 150, 100);
    assert.ok(Math.abs(next - value) < 0.005);
  }
});

test('fluid injection uses the actual rotating amplitude and adds no forcing outside the image', () => {
  const image = { x: 120, y: 80, width: 320, height: 180 };
  const domain = { x: 100, y: 0, width: 400, height: 400 };
  for (const time of [0, 15, 30, 45]) {
    const fluid = new FluidPatch();
    fluid.source = { configure() {}, update() {}, sample() { return [1, 0]; } };
    const diffuse = fluid.diffuse.bind(fluid);
    let injection;
    fluid.diffuse = (source, target, viscosity, type) => {
      if (type === 1) injection = source.slice();
      diffuse(source, target, viscosity, type);
    };
    fluid.step(time, 1 / 30, domain, 2, 5, null, image);
    const gradient = rotatingGradient(image, time);
    for (let y = 1; y <= N; y++) {
      for (let x = 1; x <= N; x++) {
        const wx = domain.x + (x - 0.5) / N * domain.width;
        const wy = domain.y + (y - 0.5) / N * domain.height;
        const expected = gradientWeight(gradient, wx, wy) * 5 * 80 * 8 / 30 * Math.exp(-0.2 / 30);
        assert.ok(Math.abs(injection[y * STRIDE + x] - expected) < 0.00001);
      }
    }
    assert.ok(fluid.u.every(Number.isFinite));
    assert.ok(fluid.v.every(Number.isFinite));
  }
});

test('global gradient stays image-bounded, leaves cursor flow unchanged, and rotates at field rate', () => {
  const field = new ParticleField();
  field.reset(marks, bounds);
  field.setTurbulence(true, 2, 1);
  field.setEnabled(true);
  field.move(400, 300, 0);
  field.advance(0, view);
  assert.deepEqual(field.flow.gradient.bounds, bounds);
  assert.equal(field.mouseFlow.gradient, null);
  const gradient = field.flow.gradient;
  field.advance(1000 / 120, view);
  assert.equal(field.flow.gradient, gradient);
  field.advance(25, view);
  assert.notEqual(field.flow.gradient, gradient);
  assert.ok(field.flow.gradient.dy > gradient.dy);
});

test('scattered particles outside the image only receive home attraction and damping', () => {
  const a = new ParticleField(), b = new ParticleField();
  for (const field of [a, b]) {
    field.reset([{ cx: 400, cy: 590 }], bounds);
    field.setMouseEnabled(false);
    field.setEnabled(true);
    field.offsets[1] = 80;
    field.offsets[3] = 10;
    field.active = true;
  }
  a.setTurbulence(true, 2, 5);
  a.advance(0, view);
  b.advance(0, view);
  assert.deepEqual([...a.offsets], [...b.offsets]);
});

test('cursor momentum stirs the simulated fluid without radial repulsion', () => {
  const fluid = new FluidPatch(), calm = new FluidPatch();
  const circle = { x: 400, y: 300, radius: 180 };
  for (let step = 0; step < 30; step++) {
    fluid.step(step / 30, 1 / 30, circle, 2, 0, { x: 600, y: 0 });
    calm.step(step / 30, 1 / 30, circle, 2, 0);
  }
  assert.ok(fluid.sample(400, 300)[0] > 10);
  assert.deepEqual([...calm.sample(400, 300)], [0, 0]);
});

test('global forcing drives distant parts of the same fluid domain', () => {
  const fluid = new FluidPatch();
  const region = { x: 0, y: -100, width: 800, height: 800 };
  for (let step = 0; step < 30; step++) fluid.step(step / 30, 1 / 30, region, 2, 20);
  for (const [x, y] of [[100, 100], [700, 100], [100, 500], [700, 500]]) {
    assert.ok(Math.hypot(...fluid.sample(x, y)) > 1, `No flow at ${x}, ${y}`);
  }
});

test('localized influence is finite at the center and zero outside its circle', () => {
  assert.equal(influence(0, 100), 1);
  assert.ok(influence(25 * 25, 100) > influence(50 * 50, 100));
  assert.equal(influence(100 * 100, 100), 0);
  assert.equal(influence(200 * 200, 100), 0);
});

test('home attraction becomes weaker with distance and approaches inverse-square magnitude', () => {
  const force = distance => homeAttraction(distance * distance) * distance;
  assert.equal(homeAttraction(0), 12);
  assert.ok(force(400) < force(100));
  const ratio = force(4000) / force(8000);
  assert.ok(Math.abs(ratio - 4) < 0.01);
  assert.ok(Number.isFinite(homeAttraction(0)));
});

test('pressure projection measurably reduces velocity divergence', () => {
  const fluid = new FluidPatch();
  for (let y = 1; y <= N; y++) {
    for (let x = 1; x <= N; x++) {
      fluid.u[y * STRIDE + x] = Math.sin(x * 0.2) * Math.sin(y * 0.17) * 100;
      fluid.v[y * STRIDE + x] = Math.cos(x * 0.13) * Math.sin(y * 0.23) * 80;
    }
  }
  fluid.boundary(fluid.u, 1);
  fluid.boundary(fluid.v, 2);
  const divergence = () => {
    let energy = 0;
    for (let y = 2; y < N; y++) {
      for (let x = 2; x < N; x++) {
        const i = y * STRIDE + x;
        const d = fluid.u[i + 1] - fluid.u[i - 1] + fluid.v[i + STRIDE] - fluid.v[i - STRIDE];
        energy += d * d;
      }
    }
    return energy;
  };
  const before = divergence();
  fluid.project();
  assert.ok(divergence() < before * 0.8, `${divergence()} vs ${before}`);
});

test('fluid advection, viscosity and projection remain finite at maximum forcing', () => {
  const fluid = new FluidPatch();
  const circle = { x: 400, y: 300, radius: 180 };
  for (let step = 0; step < 120; step++) {
    circle.x += 0.2;
    fluid.step(step / 30, 1 / 30, circle, 16, 100);
  }
  assert.ok(fluid.u.every(Number.isFinite));
  assert.ok(fluid.v.every(Number.isFinite));
  assert.ok(fluid.u.some(value => Math.abs(value) > 1));
  assert.throws(() => fluid.step(0, 1, circle, 2, 20), /Invalid fluid/);
  assert.throws(() => fluid.step(0, 1 / 30, circle, 2, 20, { x: NaN, y: 0 }), /Invalid fluid/);
  assert.throws(() => fluid.step(0, 1 / 30, { x: 0, y: 0, width: 800, height: 400 }, 2, 20), /Invalid fluid/);
  assert.throws(() => fluid.step(0, 1 / 30, circle, 16.1, 20), /Invalid fluid/);
});

test('global turbulence remains image-wide with less motion toward the quiet end', () => {
  const field = new ParticleField();
  field.reset(marks, bounds);
  field.setMouseEnabled(false);
  field.setTurbulence(true, 2, 20);
  field.setEnabled(true);
  for (let step = 0; step < 120; step++) field.advance(step * 1000 / 120, view);
  const energy = [0, 0, 0, 0];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    let moved = 0, count = 0;
    for (let i = 0; i < marks.length; i++) {
      if ((marks[i].cx >= 400 ? 1 : 0) + (marks[i].cy >= 300 ? 2 : 0) !== quadrant) continue;
      count++;
      const displacement = Math.hypot(field.offsets[i * 4], field.offsets[i * 4 + 1]);
      energy[quadrant] += displacement * displacement;
      if (displacement > 0.01) moved++;
    }
    assert.ok(moved >= count * 0.9, `Only ${moved}/${count} moved in quadrant ${quadrant}`);
  }
  assert.ok(energy[1] + energy[3] > (energy[0] + energy[2]) * 4);
  assert.equal(field.mouseFlow, null);
  assert.equal(field.mouseCircle, null);
  assert.deepEqual(field.flow.bounds, { x: 0, y: -100, width: 800, height: 800 });
});

test('strong fluid forcing produces large excursions then returns every particle exactly home', () => {
  const field = new ParticleField();
  field.reset(marks, bounds);
  field.setMouseEnabled(false);
  field.setTurbulence(true, 2, 20);
  field.setEnabled(true);
  const original = JSON.stringify(marks);
  let furthest = 0;
  for (let step = 0; step < 2400; step++) {
    field.advance(step * 1000 / 120, view);
    for (let i = 0; i < marks.length; i++) {
      furthest = Math.max(furthest, Math.hypot(field.offsets[i * 4], field.offsets[i * 4 + 1]));
    }
  }
  assert.ok(furthest >= 150, `Only ${furthest}px flight`);
  field.setTurbulence(false, 2, 20);
  for (let step = 2400; step < 16800 && field.active; step++) field.advance(step * 1000 / 120, view);
  assert.equal(field.active, false);
  assert.ok(field.offsets.every(value => value === 0));
  assert.equal(JSON.stringify(marks), original);
});
