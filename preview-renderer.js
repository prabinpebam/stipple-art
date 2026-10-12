(() => {
  function visibleBounds(view, width, height) {
    return {
      left: -view.x / view.zoom, top: -view.y / view.zoom,
      right: (width - view.x) / view.zoom, bottom: (height - view.y) / view.zoom
    };
  }

  function isVisible(mark, bounds) {
    return mark.cx + mark.radius >= bounds.left && mark.cx - mark.radius <= bounds.right &&
      mark.cy + mark.radius >= bounds.top && mark.cy - mark.radius <= bounds.bottom;
  }

  class PreviewRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
      if (gl) {
        this.gpu = new PreviewGPU(canvas, gl);
        this.scene = null;
        return;
      }
      console.warn('WebGL2 is unavailable; using the sharp Canvas 2D preview fallback.');
      this.context = canvas.getContext('2d');
      if (!this.context) throw new Error('Your browser could not create the preview canvas.');
      this.scene = null;
      this.paths = [];
    }

    resize(width, height, pixelRatio = window.devicePixelRatio || 1) {
      if (typeof StudioRuntime !== 'undefined') {
        pixelRatio = StudioRuntime.backingRatio(width, height, pixelRatio, document.documentElement.dataset.phone === 'true');
      }
      this.width = width;
      this.height = height;
      if (this.gpu) {
        this.gpu.resize(width, height, pixelRatio);
        return;
      }
      const backingWidth = Math.round(width * pixelRatio);
      const backingHeight = Math.round(height * pixelRatio);
      if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
      if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;
    }

    setScene(scene) {
      this.scene = scene;
      if (this.gpu) {
        this.gpu.setScene(scene);
        return;
      }
      this.paths = scene && scene.marks ? scene.marks.map(mark => {
        const path = new Path2D();
        if (mark.vertices) {
          for (let i = 0; i < mark.vertices.length; i++) {
            const [x, y] = mark.vertices[i];
            if (i === 0) path.moveTo(x, y);
            else path.lineTo(x, y);
          }
          path.closePath();
        } else {
          path.arc(mark.cx, mark.cy, mark.radius, 0, 2 * Math.PI);
        }
        return path;
      }) : [];
    }

    render(view, offsets = null) {
      if (this.gpu) {
        this.gpu.render(view, offsets);
        return;
      }
      const ctx = this.context;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.scene || !this.width || !this.height) return;
      const ratioX = this.canvas.width / this.width, ratioY = this.canvas.height / this.height;
      ctx.setTransform(ratioX * view.zoom, 0, 0, ratioY * view.zoom, ratioX * view.x, ratioY * view.y);
      const scene = this.scene;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, scene.width, scene.height);
      ctx.clip();
      if (scene.image) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(scene.image, scene.offsetX, scene.offsetY, scene.renderWidth, scene.renderHeight);
      } else {
        ctx.fillStyle = scene.background;
        ctx.fillRect(0, 0, scene.width, scene.height);
        const bounds = visibleBounds(view, this.width, this.height);
        let fillColor = null;
        // Keep painter order so overlapping colored shapes match the SVG.
        for (let i = 0; i < scene.marks.length; i++) {
          const mark = scene.marks[i];
          const dx = offsets ? offsets[i * 4] : 0, dy = offsets ? offsets[i * 4 + 1] : 0;
          const cx = mark.cx + dx, cy = mark.cy + dy;
          if (cx + mark.radius < bounds.left || cx - mark.radius > bounds.right ||
              cy + mark.radius < bounds.top || cy - mark.radius > bounds.bottom) continue;
          if (mark.fillColor !== fillColor) {
            fillColor = mark.fillColor;
            ctx.fillStyle = fillColor;
          }
          ctx.globalAlpha = mark.opacity ?? 1;
          if (dx || dy) {
            ctx.translate(dx, dy);
            ctx.fill(this.paths[i]);
            ctx.translate(-dx, -dy);
          } else {
            ctx.fill(this.paths[i]);
          }
        }
      }
      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { visibleBounds, isVisible, PreviewRenderer };
  else {
    globalThis.PreviewRenderer = PreviewRenderer;
    globalThis.PreviewVisibility = { visibleBounds, isVisible };
  }
})();
