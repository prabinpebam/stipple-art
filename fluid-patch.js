(() => {
  const CurlField = typeof module !== 'undefined' && module.exports ?
    require('./turbulence-field.js').TurbulenceField : globalThis.TurbulenceField;
  const N = 32, STRIDE = N + 2, LENGTH = STRIDE * STRIDE;
  const GRADIENT_PERIOD = 60;

  function rotatingGradient(bounds, time) {
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height, time].every(Number.isFinite) ||
        bounds.width <= 0 || bounds.height <= 0) {
      throw new RangeError('Invalid turbulence gradient bounds or time.');
    }
    const angle = time % GRADIENT_PERIOD * Math.PI * 2 / GRADIENT_PERIOD;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    // Project the rectangle's corners so the ramp spans exactly zero to one at every angle.
    return {
      bounds, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, dx, dy,
      span: Math.abs(dx) * bounds.width + Math.abs(dy) * bounds.height
    };
  }

  function gradientWeight(gradient, x, y) {
    const bounds = gradient.bounds;
    if (x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) return 0;
    const position = Math.max(0, Math.min(1, 0.5 + ((x - gradient.x) * gradient.dx + (y - gradient.y) * gradient.dy) / gradient.span));
    // Soften at 20% of the span, then normalize inverse-square falloff to zero at the quiet end.
    const softenedDistance = 1 + 5 * (1 - position);
    return (36 / (softenedDistance * softenedDistance) - 1) / 35;
  }

  function influence(distanceSquared, radius) {
    const radiusSquared = radius * radius;
    if (distanceSquared >= radiusSquared) return 0;
    const coreSquared = radiusSquared * 0.16;
    // Softened inverse-square force, smoothly tapered to zero at the circle edge.
    const edge = 1 - distanceSquared / radiusSquared;
    return coreSquared / (coreSquared + distanceSquared) * edge * edge;
  }

  function homeAttraction(distanceSquared) {
    const softened = 1 + distanceSquared / 10000;
    return 12 / (softened * Math.sqrt(softened));
  }

  function gridSample(grid, x, y) {
    const gx = Math.max(0.5, Math.min(N + 0.5, x));
    const gy = Math.max(0.5, Math.min(N + 0.5, y));
    const ix = Math.floor(gx), iy = Math.floor(gy), u = gx - ix, v = gy - iy;
    const index = iy * STRIDE + ix;
    return (grid[index] * (1 - u) + grid[index + 1] * u) * (1 - v) +
      (grid[index + STRIDE] * (1 - u) + grid[index + STRIDE + 1] * u) * v;
  }

  class FluidPatch {
    constructor() {
      this.u = new Float32Array(LENGTH);
      this.v = new Float32Array(LENGTH);
      this.workU = new Float32Array(LENGTH);
      this.workV = new Float32Array(LENGTH);
      this.pressure = new Float32Array(LENGTH);
      this.divergence = new Float32Array(LENGTH);
      this.source = new CurlField();
      this.sampleBuffer = new Float32Array(2);
      this.bounds = null;
      this.gradient = null;
    }

    boundary(grid, type) {
      for (let i = 1; i <= N; i++) {
        grid[i * STRIDE] = (type === 1 ? -1 : 1) * grid[i * STRIDE + 1];
        grid[i * STRIDE + N + 1] = (type === 1 ? -1 : 1) * grid[i * STRIDE + N];
        grid[i] = (type === 2 ? -1 : 1) * grid[STRIDE + i];
        grid[(N + 1) * STRIDE + i] = (type === 2 ? -1 : 1) * grid[N * STRIDE + i];
      }
      grid[0] = (grid[1] + grid[STRIDE]) * 0.5;
      grid[N + 1] = (grid[N] + grid[2 * STRIDE - 1]) * 0.5;
      grid[(N + 1) * STRIDE] = (grid[N * STRIDE] + grid[(N + 1) * STRIDE + 1]) * 0.5;
      grid[LENGTH - 1] = (grid[LENGTH - 2] + grid[LENGTH - STRIDE - 1]) * 0.5;
    }

    project() {
      const { u, v, pressure: p, divergence: d } = this;
      p.fill(0);
      for (let y = 1; y <= N; y++) {
        for (let x = 1; x <= N; x++) {
          const i = y * STRIDE + x;
          d[i] = -0.5 / N * (u[i + 1] - u[i - 1] + v[i + STRIDE] - v[i - STRIDE]);
        }
      }
      this.boundary(d, 0);
      this.boundary(p, 0);
      for (let iteration = 0; iteration < 18; iteration++) {
        for (let y = 1; y <= N; y++) {
          for (let x = 1; x <= N; x++) {
            const i = y * STRIDE + x;
            p[i] = (d[i] + p[i - 1] + p[i + 1] + p[i - STRIDE] + p[i + STRIDE]) * 0.25;
          }
        }
        this.boundary(p, 0);
      }
      for (let y = 1; y <= N; y++) {
        for (let x = 1; x <= N; x++) {
          const i = y * STRIDE + x;
          u[i] -= 0.5 * N * (p[i + 1] - p[i - 1]);
          v[i] -= 0.5 * N * (p[i + STRIDE] - p[i - STRIDE]);
        }
      }
      this.boundary(u, 1);
      this.boundary(v, 2);
    }

    diffuse(source, target, a, type) {
      target.set(source);
      for (let iteration = 0; iteration < 6; iteration++) {
        for (let y = 1; y <= N; y++) {
          for (let x = 1; x <= N; x++) {
            const i = y * STRIDE + x;
            target[i] = (source[i] + a * (target[i - 1] + target[i + 1] + target[i - STRIDE] + target[i + STRIDE])) / (1 + 4 * a);
          }
        }
        this.boundary(target, type);
      }
    }

    step(time, dt, region, frequency, amplitude, impulse = null, gradientBounds = null) {
      const circular = region && Number.isFinite(region.radius);
      const bounds = circular ? { x: region.x - region.radius, y: region.y - region.radius, width: region.radius * 2, height: region.radius * 2 } : region;
      if (!bounds || ![time, dt, bounds.x, bounds.y, bounds.width, bounds.height, frequency, amplitude].every(Number.isFinite) ||
          dt <= 0 || dt > 1 / 15 || bounds.width <= 0 || bounds.height <= 0 || Math.abs(bounds.width - bounds.height) > 0.001 ||
          (circular && region.radius <= 0) || frequency < 0.5 || frequency > 16 ||
          amplitude < 0 || amplitude > 100 || (impulse && ![impulse.x, impulse.y].every(Number.isFinite))) {
        throw new RangeError('Invalid fluid timestep, region, frequency, or amplitude.');
      }
      this.gradient = gradientBounds ? rotatingGradient(gradientBounds, time) : null;
      if (this.bounds && (bounds.x !== this.bounds.x || bounds.y !== this.bounds.y ||
          bounds.width !== this.bounds.width || bounds.height !== this.bounds.height)) {
        for (let y = 1; y <= N; y++) {
          for (let x = 1; x <= N; x++) {
            const wx = bounds.x + (x - 0.5) / N * bounds.width;
            const wy = bounds.y + (y - 0.5) / N * bounds.height;
            const gx = (wx - this.bounds.x) / this.bounds.width * N + 0.5;
            const gy = (wy - this.bounds.y) / this.bounds.height * N + 0.5;
            const i = y * STRIDE + x;
            const inside = wx >= this.bounds.x && wx <= this.bounds.x + this.bounds.width &&
              wy >= this.bounds.y && wy <= this.bounds.y + this.bounds.height;
            this.workU[i] = inside ? gridSample(this.u, gx, gy) : 0;
            this.workV[i] = inside ? gridSample(this.v, gx, gy) : 0;
          }
        }
        [this.u, this.workU] = [this.workU, this.u];
        [this.v, this.workV] = [this.workV, this.v];
      }
      this.bounds = bounds;
      this.source.configure({ x: 0, y: 0, width: 1, height: 1 }, frequency);
      this.source.update(time);
      const fade = Math.exp(-0.2 * dt);
      for (let y = 1; y <= N; y++) {
        for (let x = 1; x <= N; x++) {
          const wx = bounds.x + (x - 0.5) / N * bounds.width;
          const wy = bounds.y + (y - 0.5) / N * bounds.height;
          const weight = circular ? influence((wx - region.x) ** 2 + (wy - region.y) ** 2, region.radius) : 1;
          const strength = amplitude * 80 * (this.gradient ? gradientWeight(this.gradient, wx, wy) : 1);
          const velocity = this.source.sample((x - 0.5) / N, (y - 0.5) / N);
          const i = y * STRIDE + x;
          this.u[i] = (this.u[i] + (velocity[0] * strength + (impulse ? impulse.x * 0.75 : 0) - this.u[i]) * weight * 8 * dt) * fade;
          this.v[i] = (this.v[i] + (velocity[1] * strength + (impulse ? impulse.y * 0.75 : 0) - this.v[i]) * weight * 8 * dt) * fade;
        }
      }
      const viscosity = 250 * dt * (N / bounds.width) ** 2;
      this.diffuse(this.u, this.workU, viscosity, 1);
      this.diffuse(this.v, this.workV, viscosity, 2);
      [this.u, this.workU] = [this.workU, this.u];
      [this.v, this.workV] = [this.workV, this.v];
      this.project();
      for (let y = 1; y <= N; y++) {
        for (let x = 1; x <= N; x++) {
          const i = y * STRIDE + x;
          const gx = x - dt * this.u[i] * N / bounds.width;
          const gy = y - dt * this.v[i] * N / bounds.height;
          this.workU[i] = gridSample(this.u, gx, gy);
          this.workV[i] = gridSample(this.v, gx, gy);
        }
      }
      [this.u, this.workU] = [this.workU, this.u];
      [this.v, this.workV] = [this.workV, this.v];
      this.boundary(this.u, 1);
      this.boundary(this.v, 2);
      this.project();
    }

    sample(x, y) {
      if (!this.bounds) return this.sampleBuffer.fill(0);
      const gx = Math.max(0.5, Math.min(N + 0.5, (x - this.bounds.x) / this.bounds.width * N + 0.5));
      const gy = Math.max(0.5, Math.min(N + 0.5, (y - this.bounds.y) / this.bounds.height * N + 0.5));
      const ix = Math.floor(gx), iy = Math.floor(gy), u = gx - ix, v = gy - iy;
      const index = iy * STRIDE + ix;
      for (let component = 0; component < 2; component++) {
        const grid = component === 0 ? this.u : this.v;
        this.sampleBuffer[component] = (grid[index] * (1 - u) + grid[index + 1] * u) * (1 - v) +
          (grid[index + STRIDE] * (1 - u) + grid[index + STRIDE + 1] * u) * v;
      }
      return this.sampleBuffer;
    }
  }

  const physics = { FluidPatch, influence, homeAttraction, rotatingGradient, gradientWeight, GRADIENT_PERIOD, N, STRIDE };
  if (typeof module !== 'undefined' && module.exports) module.exports = physics;
  else globalThis.LocalFluid = physics;
})();
