(() => {
  const STEP = 1 / 120;
  const MAX_STEPS = 8;

  class ParticleField {
    constructor() {
      this.enabled = false;
      this.reset([]);
    }

    reset(marks) {
      this.marks = marks;
      this.offsets = new Float32Array(marks.length * 4);
      this.pointer = null;
      this.lastTime = null;
      this.accumulator = 0;
      this.time = 0;
      this.active = false;
      this.motion = { speed: 0, x: 0 };
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) this.reset(this.marks);
    }

    move(x, y, timestamp) {
      if (!this.enabled || !this.marks.length) return;
      const previous = this.pointer;
      const dt = previous ? Math.max(0.008, (timestamp - previous.timestamp) / 1000) : 1;
      this.pointer = {
        x, y, timestamp,
        vx: previous ? Math.max(-1200, Math.min(1200, (x - previous.x) / dt)) : 0,
        vy: previous ? Math.max(-1200, Math.min(1200, (y - previous.y) / dt)) : 0
      };
      this.active = true;
    }

    leave() {
      this.pointer = null;
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
      const pointer = this.pointer;
      const zoom = view.zoom;
      const radius = 110;
      const drag = Math.exp(-5 * STEP);
      const pointerX = pointer ? (pointer.x - view.x) / zoom : 0;
      const pointerY = pointer ? (pointer.y - view.y) / zoom : 0;
      const logicalRadius = radius / zoom;
      let moving = false;
      let speedSum = 0, positionSum = 0, movingCount = 0;
      this.time += STEP;
      for (let i = 0; i < this.marks.length; i++) {
        const mark = this.marks[i], index = i * 4;
        let x = this.offsets[index], y = this.offsets[index + 1];
        let vx = this.offsets[index + 2], vy = this.offsets[index + 3];
        if (x === 0 && y === 0 && vx === 0 && vy === 0 &&
            (!pointer || Math.abs(mark.cx - pointerX) >= logicalRadius || Math.abs(mark.cy - pointerY) >= logicalRadius)) continue;
        let ax = -12 * x, ay = -12 * y;
        if (pointer) {
          let dx = (mark.cx + x) * zoom + view.x - pointer.x;
          let dy = (mark.cy + y) * zoom + view.y - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < radius) {
            if (distance < 0.01) {
              // A deterministic direction avoids a singularity directly under the cursor.
              dx = Math.cos(i * 2.399963);
              dy = Math.sin(i * 2.399963);
            } else {
              dx /= distance;
              dy /= distance;
            }
            const falloff = (1 - distance / radius) ** 2;
            const speed = Math.hypot(pointer.vx, pointer.vy);
            const swirl = Math.sin(this.time * 8 + i * 2.399963) * (450 + speed * 0.5);
            ax += falloff * (dx * (2400 + speed) - dy * swirl + pointer.vx * 2) / zoom;
            ay += falloff * (dy * (2400 + speed) + dx * swirl + pointer.vy * 2) / zoom;
          }
        }
        vx = (vx + ax * STEP) * drag;
        vy = (vy + ay * STEP) * drag;
        const speed = Math.hypot(vx, vy), maxSpeed = 900 / zoom;
        if (speed > maxSpeed) { vx *= maxSpeed / speed; vy *= maxSpeed / speed; }
        x += vx * STEP;
        y += vy * STEP;
        if (Math.hypot(x, y) * zoom < 0.03 && Math.hypot(vx, vy) * zoom < 0.05) {
          x = y = vx = vy = 0;
        } else {
          moving = true;
          const screenX = (mark.cx + x) * zoom + view.x;
          const screenY = (mark.cy + y) * zoom + view.y;
          if (screenX >= 0 && screenX <= view.width && screenY >= 0 && screenY <= view.height) {
            const speed = Math.hypot(vx, vy) * zoom;
            speedSum += speed;
            positionSum += screenX * speed;
            movingCount++;
          }
        }
        this.offsets[index] = x;
        this.offsets[index + 1] = y;
        this.offsets[index + 2] = vx;
        this.offsets[index + 3] = vy;
      }
      if (pointer) {
        pointer.vx *= Math.exp(-10 * STEP);
        pointer.vy *= Math.exp(-10 * STEP);
      }
      this.active = moving;
      this.motion = {
        speed: movingCount ? speedSum / Math.max(20, movingCount) : 0,
        x: speedSum ? positionSum / speedSum : 0
      };
      if (!moving) {
        this.lastTime = null;
        this.accumulator = 0;
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { ParticleField, STEP, MAX_STEPS };
  else globalThis.ParticleField = ParticleField;
})();
