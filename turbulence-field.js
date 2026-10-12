(() => {
  const CELLS = 32;
  const SIDE = CELLS + 1;
  const UPDATE_HZ = 30;
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const mix = (a, b, t) => a + (b - a) * t;
  const spatial = (grid, i, u, v) => mix(mix(grid[i], grid[i + 2], u),
    mix(grid[i + SIDE * 2], grid[i + SIDE * 2 + 2], u), v);

  function hash(x, y, z) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
  }

  function noise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
    const lower = mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), u),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v);
    const upper = mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v);
    return mix(lower, upper, w);
  }

  class TurbulenceField {
    constructor() {
      this.current = new Float32Array(SIDE * SIDE * 2);
      this.next = new Float32Array(this.current.length);
      this.potential = new Float32Array((SIDE + 2) * (SIDE + 2));
      this.sampleBuffer = new Float32Array(2);
      this.bounds = { x: 0, y: 0, width: 1, height: 1 };
      this.frequency = 2;
      this.bucket = -1;
      this.blend = 0;
    }

    configure(bounds, frequency) {
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height, frequency].every(Number.isFinite) ||
          bounds.width <= 0 || bounds.height <= 0 || frequency < 0.5 || frequency > 16) {
        throw new RangeError('Turbulence needs valid bounds and a frequency between 0.5 and 16.');
      }
      if (this.frequency !== frequency || Object.keys(this.bounds).some(key => this.bounds[key] !== bounds[key])) {
        this.bounds = { ...bounds };
        this.frequency = frequency;
        this.bucket = -1;
      }
    }

    build(time, target) {
      const { width, height } = this.bounds;
      const longest = Math.max(width, height), f = this.frequency;
      const stride = SIDE + 2;
      for (let y = -1; y <= SIDE; y++) {
        for (let x = -1; x <= SIDE; x++) {
          const nx = x / CELLS * width / longest * f + 17.3;
          const ny = y / CELLS * height / longest * f + 29.1;
          this.potential[(y + 1) * stride + x + 1] =
            noise(nx, ny, time * 0.4 + 3.7) + 0.5 * noise(nx * 2 + 8.2, ny * 2 - 5.4, time * 0.3 + 11.9);
        }
      }
      let maximum = 1;
      for (let y = 0; y < SIDE; y++) {
        for (let x = 0; x < SIDE; x++) {
          const center = (y + 1) * stride + x + 1;
          const dx = (this.potential[center + stride] - this.potential[center - stride]) * CELLS * longest / (2 * height * f);
          const dy = -(this.potential[center + 1] - this.potential[center - 1]) * CELLS * longest / (2 * width * f);
          const index = (y * SIDE + x) * 2;
          target[index] = dx;
          target[index + 1] = dy;
          maximum = Math.max(maximum, Math.hypot(dx, dy));
        }
      }
      // One global scale bounds the force without normalizing away local structure.
      for (let i = 0; i < target.length; i++) target[i] /= maximum;
    }

    update(time) {
      const bucket = Math.floor(time * UPDATE_HZ);
      if (bucket !== this.bucket) {
        if (bucket === this.bucket + 1 && this.bucket >= 0) {
          const old = this.current;
          this.current = this.next;
          this.next = old;
        } else this.build(bucket / UPDATE_HZ, this.current);
        this.build((bucket + 1) / UPDATE_HZ, this.next);
        this.bucket = bucket;
      }
      this.blend = Math.max(0, Math.min(1, time * UPDATE_HZ - bucket));
    }

    sample(x, y) {
      const gx = Math.max(0, Math.min(CELLS, (x - this.bounds.x) / this.bounds.width * CELLS));
      const gy = Math.max(0, Math.min(CELLS, (y - this.bounds.y) / this.bounds.height * CELLS));
      const ix = Math.min(CELLS - 1, Math.floor(gx)), iy = Math.min(CELLS - 1, Math.floor(gy));
      const u = gx - ix, v = gy - iy, index = (iy * SIDE + ix) * 2;
      for (let component = 0; component < 2; component++) {
        const i = index + component;
        this.sampleBuffer[component] = mix(spatial(this.current, i, u, v), spatial(this.next, i, u, v), this.blend);
      }
      return this.sampleBuffer;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { TurbulenceField, CELLS, UPDATE_HZ };
  else globalThis.TurbulenceField = TurbulenceField;
})();
