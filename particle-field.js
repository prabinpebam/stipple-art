(() => {
  const STEP = 1 / 120;
  const MAX_STEPS = 8;
  const MOUSE_FREQUENCY = 2;
  const MOUSE_SCREEN_AMPLITUDE = 20;
  const Physics = typeof module !== 'undefined' && module.exports ?
    require('./fluid-patch.js') : globalThis.LocalFluid;

  function cacheVelocity(cache, index, velocity, first) {
    const x = velocity ? velocity[0] : 0, y = velocity ? velocity[1] : 0;
    cache[index] = first ? x : cache[index + 2];
    cache[index + 1] = first ? y : cache[index + 3];
    cache[index + 2] = x;
    cache[index + 3] = y;
  }

  class ParticleField {
    constructor() {
      this.enabled = false;
      this.mouseEnabled = true;
      this.turbulence = { enabled: false, frequency: 10, amplitude: 20 };
      this.bounds = { x: 0, y: 0, width: 1, height: 1 };
      this.reset([]);
    }

    reset(marks, bounds = this.bounds) {
      this.marks = marks;
      this.offsets = new Float32Array(marks.length * 4);
      this.pointer = null;
      this.lastTime = null;
      this.accumulator = 0;
      this.time = 0;
      this.active = false;
      this.motion = { speed: 0, x: 0 };
      this.bounds = bounds;
      const side = Math.max(bounds.width, bounds.height);
      this.globalBounds = {
        x: bounds.x + (bounds.width - side) / 2, y: bounds.y + (bounds.height - side) / 2,
        width: side, height: side
      };
      this.forceBucket = -1;
      this.mouseForceBucket = -1;
      this.turbulenceForces = null;
      this.mouseForces = null;
      this.flow = null;
      this.mouseFlow = null;
      this.mouseCircle = null;
      if (this.enabled && this.turbulence.enabled && this.turbulence.amplitude > 0 && marks.length) this.active = true;
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) this.reset(this.marks);
      else if (this.turbulence.enabled && this.turbulence.amplitude > 0 && this.marks.length) this.active = true;
    }

    setMouseEnabled(enabled) {
      this.mouseEnabled = enabled;
      if (!enabled) this.leave();
    }

    setTurbulence(enabled, frequency, amplitude) {
      if (!Number.isFinite(frequency) || frequency < 0.5 || frequency > 16 ||
          !Number.isFinite(amplitude) || amplitude < 0 || amplitude > 100) {
        throw new RangeError('Turbulence frequency must be 0.5-16 and amplitude 0-100.');
      }
      if (this.turbulence.frequency !== frequency || this.turbulence.enabled !== enabled) this.forceBucket = -1;
      this.turbulence = { enabled, frequency, amplitude };
      if (!enabled || amplitude === 0) {
        this.flow = null;
        this.turbulenceForces = null;
        this.forceBucket = -1;
      }
      if (this.enabled && enabled && amplitude > 0 && this.marks.length) this.active = true;
    }

    move(x, y, timestamp) {
      if (!this.enabled || !this.mouseEnabled || !this.marks.length) return;
      const previous = this.pointer;
      const dt = previous ? Math.max(0.008, (timestamp - previous.timestamp) / 1000) : 1;
      this.pointer = {
        x, y, timestamp,
        vx: previous ? Math.max(-1200, Math.min(1200, (x - previous.x) / dt)) : 0,
        vy: previous ? Math.max(-1200, Math.min(1200, (y - previous.y) / dt)) : 0
      };
      if (!previous) this.mouseForceBucket = -1;
      this.active = true;
    }

    leave() {
      this.pointer = null;
      this.mouseCircle = null;
      this.mouseFlow = null;
      this.mouseForces = null;
      this.mouseForceBucket = -1;
    }

    advance(timestamp, view) {
      if (!this.enabled || !this.active) return false;
      if (this.lastTime === null) this.lastTime = timestamp - STEP * 1000;
      const elapsed = Math.max(0, Math.min(STEP * MAX_STEPS, (timestamp - this.lastTime) / 1000));
      this.lastTime = timestamp;
      this.accumulator = Math.min(STEP * MAX_STEPS, this.accumulator + elapsed);
      let steps = 0;
      while (this.accumulator + 1e-10 >= STEP && steps < MAX_STEPS) {
        this.integrate(view);
        this.accumulator = Math.max(0, this.accumulator - STEP);
        steps++;
      }
      return this.active;
    }

    integrate(view) {
      const pointer = this.pointer, zoom = view.zoom;
      const pointerX = pointer ? (pointer.x - view.x) / zoom : 0;
      const pointerY = pointer ? (pointer.y - view.y) / zoom : 0;
      const radius = 180 / zoom;
      const turbulent = this.turbulence.enabled && this.turbulence.amplitude > 0 && this.marks.length > 0;
      const phase = (this.time + STEP) * 30, bucket = Math.floor(phase + 1e-8);
      const blend = Math.max(0, Math.min(1, phase - bucket));
      const refreshGlobal = turbulent && bucket !== this.forceBucket;
      const firstGlobal = this.forceBucket < 0;
      const refreshMouse = Boolean(pointer) && bucket !== this.mouseForceBucket;
      const firstMouse = this.mouseForceBucket < 0;
      if (turbulent) {
        if (!this.flow) this.flow = new Physics.FluidPatch();
        if (refreshGlobal) this.flow.step(this.time + STEP, 1 / 30, this.globalBounds,
          this.turbulence.frequency, this.turbulence.amplitude, null, this.bounds);
        if (!this.turbulenceForces) this.turbulenceForces = new Float32Array(this.marks.length * 4);
        this.forceBucket = bucket;
      }
      if (pointer) {
        this.mouseCircle = { x: pointerX, y: pointerY, radius };
        if (!this.mouseFlow) this.mouseFlow = new Physics.FluidPatch();
        if (refreshMouse) {
          this.mouseFlow.step(this.time + STEP, 1 / 30, this.mouseCircle, MOUSE_FREQUENCY, MOUSE_SCREEN_AMPLITUDE / zoom,
            { x: pointer.vx / zoom, y: pointer.vy / zoom });
        }
        if (!this.mouseForces) this.mouseForces = new Float32Array(this.marks.length * 4);
        this.mouseForceBucket = bucket;
      }
      const drag = Math.exp(-1.6 * STEP), maxSpeedSquared = 1200 * 1200, zoomSquared = zoom * zoom;
      const global = this.bounds;
      let moving = false, mouseAffected = false, speedSum = 0, positionSum = 0, movingCount = 0;
      this.time += STEP;
      for (let i = 0; i < this.marks.length; i++) {
        const mark = this.marks[i], index = i * 4;
        let x = this.offsets[index], y = this.offsets[index + 1];
        let vx = this.offsets[index + 2], vy = this.offsets[index + 3];
        const worldX = mark.cx + x, worldY = mark.cy + y;
        if (!turbulent && x === 0 && y === 0 && vx === 0 && vy === 0 &&
            (!pointer || Math.abs(worldX - pointerX) >= radius || Math.abs(worldY - pointerY) >= radius)) {
          if (refreshMouse) cacheVelocity(this.mouseForces, index, null, true);
          continue;
        }
        const attraction = Physics.homeAttraction(x * x + y * y);
        let ax = -attraction * x, ay = -attraction * y;
        let fluidDriven = false;
        if (turbulent) {
          const inside = worldX >= global.x && worldX <= global.x + global.width &&
            worldY >= global.y && worldY <= global.y + global.height;
          if (refreshGlobal) cacheVelocity(this.turbulenceForces, index, inside ? this.flow.sample(worldX, worldY) : null, firstGlobal);
          if (inside) {
            fluidDriven = true;
            const fluidX = this.turbulenceForces[index] + (this.turbulenceForces[index + 2] - this.turbulenceForces[index]) * blend;
            const fluidY = this.turbulenceForces[index + 1] + (this.turbulenceForces[index + 3] - this.turbulenceForces[index + 1]) * blend;
            ax += (fluidX - vx) * 5;
            ay += (fluidY - vy) * 5;
          }
        }
        if (pointer) {
          const dx = worldX - pointerX, dy = worldY - pointerY;
          const weight = Physics.influence(dx * dx + dy * dy, radius);
          if (refreshMouse) cacheVelocity(this.mouseForces, index, weight ? this.mouseFlow.sample(worldX, worldY) : null, firstMouse);
          if (weight > 0) {
            fluidDriven = true;
            mouseAffected = true;
            const fluidX = this.mouseForces[index] + (this.mouseForces[index + 2] - this.mouseForces[index]) * blend;
            const fluidY = this.mouseForces[index + 1] + (this.mouseForces[index + 3] - this.mouseForces[index + 1]) * blend;
            ax += (fluidX - vx) * weight * 5;
            ay += (fluidY - vy) * weight * 5;
          }
        }
        vx = (vx + ax * STEP) * drag;
        vy = (vy + ay * STEP) * drag;
        let speedSquared = vx * vx + vy * vy;
        if (speedSquared > maxSpeedSquared) {
          const ratio = 1200 / Math.sqrt(speedSquared);
          vx *= ratio; vy *= ratio;
          speedSquared = maxSpeedSquared;
        }
        x += vx * STEP; y += vy * STEP;
        if (!fluidDriven && (x * x + y * y) * zoomSquared < 0.0009 && speedSquared * zoomSquared < 0.0025) {
          x = y = vx = vy = 0;
        } else {
          moving = true;
          const screenX = (mark.cx + x) * zoom + view.x, screenY = (mark.cy + y) * zoom + view.y;
          if (screenX >= 0 && screenX <= view.width && screenY >= 0 && screenY <= view.height) {
            const speed = Math.sqrt(speedSquared) * zoom;
            speedSum += speed; positionSum += screenX * speed; movingCount++;
          }
        }
        this.offsets[index] = x; this.offsets[index + 1] = y;
        this.offsets[index + 2] = vx; this.offsets[index + 3] = vy;
      }
      if (pointer) {
        pointer.vx *= Math.exp(-10 * STEP);
        pointer.vy *= Math.exp(-10 * STEP);
      }
      this.active = moving || turbulent || mouseAffected;
      this.motion = { speed: movingCount ? speedSum / Math.max(20, movingCount) : 0, x: speedSum ? positionSum / speedSum : 0 };
      if (!this.active) { this.lastTime = null; this.accumulator = 0; }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { ParticleField, STEP, MAX_STEPS };
  else globalThis.ParticleField = ParticleField;
})();
