(() => {
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 8;

  function zoomAt(view, zoom, anchor) {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const ratio = scale / view.zoom;
    return { zoom: scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio };
  }

  function constrain(view, width, height) {
    const dx = width * (1 - view.zoom), dy = height * (1 - view.zoom);
    return {
      zoom: view.zoom,
      x: Math.min(Math.max(0, dx), Math.max(Math.min(0, dx), view.x)),
      y: Math.min(Math.max(0, dy), Math.max(Math.min(0, dy), view.y))
    };
  }

  class PreviewViewport {
    constructor(stage, canvas, draw) {
      this.stage = stage;
      this.canvas = canvas;
      this.draw = draw;
      this.view = { zoom: 1, x: 0, y: 0 };
      this.enabled = false;
      this.frame = null;
      this.pointers = new Map();
      this.width = stage.clientWidth;
      this.height = stage.clientHeight;
      this.out = document.getElementById('zoomOutButton');
      this.into = document.getElementById('zoomInButton');
      this.fit = document.getElementById('zoomFitButton');
      this.output = document.getElementById('zoomValue');
      this.out.addEventListener('click', () => this.zoomBy(1 / 1.25));
      this.into.addEventListener('click', () => this.zoomBy(1.25));
      this.fit.addEventListener('click', () => this.reset());
      stage.addEventListener('wheel', event => {
        if (!this.enabled || event.target !== canvas) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
        const delta = Math.min(300, Math.max(-300, event.deltaY * unit));
        this.zoomBy(Math.exp(-delta * 0.002), this.localPoint(event));
      }, { passive: false });
      stage.addEventListener('dblclick', event => {
        if (!this.enabled || event.target !== canvas) return;
        event.preventDefault();
        this.zoomBy(event.shiftKey ? 0.5 : 2, this.localPoint(event));
      });
      stage.addEventListener('keydown', event => {
        if (!this.enabled || event.target !== stage || event.ctrlKey || event.metaKey || event.altKey) return;
        const pans = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (event.key === '+' || event.key === '=') this.zoomBy(1.25);
        else if (event.key === '-') this.zoomBy(1 / 1.25);
        else if (event.key === '0' || event.key === 'Home') this.reset();
        else if (Object.hasOwn(pans, event.key)) {
          const [x, y] = pans[event.key];
          this.pan(x, y);
        } else return;
        event.preventDefault();
      });
      canvas.addEventListener('pointerdown', event => {
        if (!this.enabled || (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1)) return;
        event.preventDefault();
        stage.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, this.localPoint(event));
        stage.classList.add('is-panning');
      });
      canvas.addEventListener('pointermove', event => {
        if (!this.pointers.has(event.pointerId)) return;
        const oldPoints = [...this.pointers.values()];
        const previous = this.pointers.get(event.pointerId);
        const next = this.localPoint(event);
        this.pointers.set(event.pointerId, next);
        if (this.pointers.size === 1) {
          this.pan(next.x - previous.x, next.y - previous.y);
        } else {
          const newPoints = [...this.pointers.values()];
          const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
          const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
          const before = midpoint(oldPoints), after = midpoint(newPoints);
          const oldDistance = distance(oldPoints);
          if (oldDistance > 0) this.view = zoomAt(this.view, this.view.zoom * distance(newPoints) / oldDistance, before);
          this.pan(after.x - before.x, after.y - before.y);
        }
      });
      const finish = event => {
        this.pointers.delete(event.pointerId);
        if (!this.pointers.size) stage.classList.remove('is-panning');
      };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => canvas.addEventListener(type, finish));
      this.apply();
    }

    localPoint(event) {
      const bounds = this.stage.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      this.stage.classList.toggle('is-navigable', enabled);
      if (!enabled) this.endGesture();
      this.updateControls();
    }

    endGesture() {
      const ids = [...this.pointers.keys()];
      this.pointers.clear();
      ids.forEach(id => {
        if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
      });
      this.stage.classList.remove('is-panning');
    }

    reset() {
      this.endGesture();
      this.view = { zoom: 1, x: 0, y: 0 };
      this.schedule();
    }

    resize() {
      const width = this.stage.clientWidth, height = this.stage.clientHeight;
      if (this.width) this.view.x *= width / this.width;
      if (this.height) this.view.y *= height / this.height;
      this.width = width;
      this.height = height;
      this.endGesture();
      this.schedule();
    }

    zoomBy(factor, anchor = { x: this.width / 2, y: this.height / 2 }) {
      if (!this.enabled) return;
      this.view = zoomAt(this.view, this.view.zoom * factor, anchor);
      this.schedule();
    }

    pan(x, y) {
      this.view.x += x;
      this.view.y += y;
      this.schedule();
    }

    schedule() {
      this.view = constrain(this.view, this.width, this.height);
      // Navigation and artwork changes share one drawing frame.
      if (this.frame === null) this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.apply();
      });
    }

    updateControls() {
      this.out.disabled = !this.enabled || this.view.zoom <= MIN_ZOOM;
      this.into.disabled = !this.enabled || this.view.zoom >= MAX_ZOOM;
      this.fit.disabled = !this.enabled;
      this.output.value = `${Math.round(this.view.zoom * 100)}%`;
    }

    apply() {
      this.draw(this.view);
      this.updateControls();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zoomAt, constrain, MIN_ZOOM, MAX_ZOOM, PreviewViewport };
  } else {
    globalThis.PreviewViewport = PreviewViewport;
  }
})();
