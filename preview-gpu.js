(() => {
  const vertexSource = `#version 300 es
    in vec2 aCorner;
    in vec4 aMark;
    in vec4 aStyle;
    uniform vec2 uSize;
    uniform vec3 uView;
    uniform float uDensity;
    out vec2 vLocal;
    out vec2 vPoint;
    flat out vec4 vStyle;
    void main() {
      vec2 local = aCorner * (aMark.z + 1.0 / (uView.z * uDensity));
      float c = cos(aMark.w), s = sin(aMark.w);
      vLocal = mat2(c, -s, s, c) * local / aMark.z;
      vStyle = aStyle;
      vPoint = aMark.xy + local;
      vec2 screen = (aMark.xy + local) * uView.z + uView.xy;
      gl_Position = vec4(screen.x / uSize.x * 2.0 - 1.0, 1.0 - screen.y / uSize.y * 2.0, 0, 1);
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec2 vLocal;
    in vec2 vPoint;
    flat in vec4 vStyle;
    uniform float uUseMask;
    uniform vec4 uMaskRect;
    uniform sampler2D uMask;
    out vec4 color;
    void main() {
      float distance = length(vLocal) - 1.0;
      int sides = int(vStyle.w);
      if (sides > 0) {
        distance = -2.0;
        float stepAngle = 6.28318530718 / float(sides);
        float apothem = cos(stepAngle * 0.5);
        for (int i = 0; i < 6; i++) {
          if (i >= sides) break;
          float angle = (float(i) + 0.5) * stepAngle;
          distance = max(distance, dot(vLocal, vec2(cos(angle), sin(angle))) - apothem);
        }
      }
      float aa = max(fwidth(distance), 0.00001);
      float alpha = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, distance);
      if (uUseMask > 0.5) {
        vec2 uv = (vPoint - uMaskRect.xy) / uMaskRect.zw;
        if (any(lessThan(uv, vec2(0))) || any(greaterThan(uv, vec2(1)))) discard;
        alpha *= texture(uMask, uv).a;
      }
      if (alpha <= 0.0) discard;
      color = vec4(vStyle.rgb, alpha);
    }`;
  const imageVertex = `#version 300 es
    in vec2 aCorner;
    uniform vec2 uSize;
    uniform vec3 uView;
    uniform vec4 uRect;
    out vec2 vUV;
    void main() {
      vUV = aCorner * 0.5 + 0.5;
      vec2 screen = (uRect.xy + vUV * uRect.zw) * uView.z + uView.xy;
      gl_Position = vec4(screen.x / uSize.x * 2.0 - 1.0, 1.0 - screen.y / uSize.y * 2.0, 0, 1);
    }`;
  const imageFragment = `#version 300 es
    precision highp float;
    in vec2 vUV;
    uniform sampler2D uImage;
    out vec4 color;
    void main() { color = texture(uImage, vUV); }`;

  class PreviewGPU {
    constructor(canvas, gl) {
      this.canvas = canvas;
      this.gl = gl;
      this.lost = false;
      this.colorContext = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      this.colorContext.canvas.width = this.colorContext.canvas.height = 1;
      this.initialize();
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        this.lost = true;
        canvas.dispatchEvent(new CustomEvent('preview-render-error', { detail: 'Graphics context lost. Waiting for the browser to restore it.' }));
      });
      canvas.addEventListener('webglcontextrestored', () => {
        try {
          this.lost = false;
          this.initialize();
          this.setScene(this.scene);
          canvas.dispatchEvent(new CustomEvent('preview-render-restored'));
        } catch (error) {
          console.error('Preview graphics restoration failed:', error);
          canvas.dispatchEvent(new CustomEvent('preview-render-error', { detail: error.message }));
        }
      });
    }

    program(vertex, fragment) {
      const gl = this.gl;
      const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, i === 0 ? vertex : fragment);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(`Preview shader compilation failed: ${message}`);
        }
        return shader;
      });
      const program = gl.createProgram();
      shaders.forEach(shader => gl.attachShader(program, shader));
      gl.linkProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Preview shader linking failed: ${gl.getProgramInfoLog(program)}`);
      }
      return program;
    }

    initialize() {
      const gl = this.gl;
      this.markProgram = this.program(vertexSource, fragmentSource);
      this.imageProgram = this.program(imageVertex, imageFragment);
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.instances = gl.createBuffer();
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    color(value) {
      const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
      if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, 1];
      const ctx = this.colorContext;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const pixel = ctx.getImageData(0, 0, 1, 1).data;
      return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255, pixel[3] / 255];
    }

    resize(width, height, ratio) {
      this.width = width;
      this.height = height;
      const w = Math.round(width * ratio), h = Math.round(height * ratio);
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
    }

    setScene(scene) {
      this.scene = scene;
      if (this.lost) return;
      const gl = this.gl;
      this.background = scene && scene.background ? this.color(scene.background) : [0, 0, 0, 0];
      const marks = scene && scene.marks ? scene.marks : [];
      this.data = new Float32Array(marks.length * 8);
      this.visible = new Float32Array(this.data.length);
      const colors = new Map();
      for (let i = 0; i < marks.length; i++) {
        const mark = marks[i];
        if (!colors.has(mark.fillColor)) colors.set(mark.fillColor, this.color(mark.fillColor));
        const color = colors.get(mark.fillColor);
        const angle = mark.vertices ? Math.atan2(mark.vertices[0][1] - mark.cy, mark.vertices[0][0] - mark.cx) : 0;
        this.data.set([mark.cx, mark.cy, mark.radius, angle, color[0], color[1], color[2], mark.vertices ? mark.vertices.length : 0], i * 8);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      if (scene && (scene.image || scene.mask)) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene.image || scene.mask);
      } else {
        // Release the previous photo texture when switching to generated geometry.
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
    }

    render(view) {
      if (this.lost) return;
      const gl = this.gl, scene = this.scene;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!scene || !this.width || !this.height) return;
      const sx = this.canvas.width / this.width, sy = this.canvas.height / this.height;
      const left = Math.max(0, Math.floor(view.x * sx)), top = Math.max(0, Math.floor(view.y * sy));
      const right = Math.min(this.canvas.width, Math.ceil((view.x + scene.width * view.zoom) * sx));
      const bottom = Math.min(this.canvas.height, Math.ceil((view.y + scene.height * view.zoom) * sy));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(left, this.canvas.height - bottom, Math.max(0, right - left), Math.max(0, bottom - top));
      gl.clearColor(...this.background);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const program = scene.image ? this.imageProgram : this.markProgram;
      gl.useProgram(program);
      gl.uniform2f(gl.getUniformLocation(program, 'uSize'), this.width, this.height);
      gl.uniform3f(gl.getUniformLocation(program, 'uView'), view.x, view.y, view.zoom);
      const corner = gl.getAttribLocation(program, 'aCorner');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(corner, 0);
      if (scene.image) {
        gl.uniform4f(gl.getUniformLocation(program, 'uRect'), scene.offsetX, scene.offsetY, scene.renderWidth, scene.renderHeight);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        gl.uniform1f(gl.getUniformLocation(program, 'uUseMask'), scene.mask ? 1 : 0);
        if (scene.mask) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.texture);
          gl.uniform1i(gl.getUniformLocation(program, 'uMask'), 0);
          gl.uniform4f(gl.getUniformLocation(program, 'uMaskRect'), scene.offsetX, scene.offsetY, scene.renderWidth, scene.renderHeight);
        }
        const bounds = PreviewVisibility.visibleBounds(view, this.width, this.height);
        let count = 0;
        for (let i = 0; i < scene.marks.length; i++) {
          const mark = scene.marks[i];
          if (!PreviewVisibility.isVisible(mark, bounds)) continue;
          this.visible.set(this.data.subarray(i * 8, i * 8 + 8), count++ * 8);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.visible, 0, count * 8);
        for (const [name, offset] of [['aMark', 0], ['aStyle', 16]]) {
          const location = gl.getAttribLocation(program, name);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 32, offset);
          gl.vertexAttribDivisor(location, 1);
        }
        gl.uniform1f(gl.getUniformLocation(program, 'uDensity'), Math.min(sx, sy));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      }
    }
  }

  globalThis.PreviewGPU = PreviewGPU;
})();
