(() => {
  function pngSize(scene, resolution) {
    if (!scene || !(scene.width > 0) || !(scene.height > 0)) throw new Error('No artwork is ready to export.');
    if (!['original', '1024', '2048', '4096'].includes(resolution)) throw new Error('Choose a supported PNG resolution.');
    const scale = resolution === 'original' ? 1 : Number(resolution) / Math.max(scene.width, scene.height);
    const width = Math.max(1, Math.round(scene.width * scale));
    const height = Math.max(1, Math.round(scene.height * scale));
    if (width > 8192 || height > 8192 || width * height > 16777216) {
      throw new Error('This PNG is too large. Choose 1K, 2K, or 4K.');
    }
    return { width, height };
  }

  function svgText(scene) {
    if (!scene || !scene.marks || !scene.marks.length) throw new Error('Generate artwork before exporting.');
    const { width, height, background, marks } = scene;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
    svg += `<rect width="100%" height="100%" fill="${background}"/>`;
    for (const mark of marks) {
      const style = `fill="${mark.fillColor}" fill-opacity="${mark.opacity ?? 1}"`;
      svg += mark.vertices ?
        `<polygon points="${mark.vertices.map(vertex => vertex.join(',')).join(' ')}" ${style}/>` :
        `<circle cx="${mark.cx}" cy="${mark.cy}" r="${mark.radius}" ${style}/>`;
    }
    return svg + '</svg>';
  }

  async function pngBlob(scene, resolution, job) {
    const { width, height } = pngSize(scene, resolution);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('The browser could not allocate an export canvas. Try a smaller PNG.');
      ctx.scale(width / scene.width, height / scene.height);
      ctx.fillStyle = scene.background;
      ctx.fillRect(0, 0, scene.width, scene.height);
      let deadline = performance.now() + 8;
      for (const mark of scene.marks) {
        if (performance.now() >= deadline) {
          await StudioRuntime.yieldToInput(job);
          deadline = performance.now() + 8;
        }
        ctx.beginPath();
        if (mark.vertices) {
          mark.vertices.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
          ctx.closePath();
        } else ctx.arc(mark.cx, mark.cy, mark.radius, 0, Math.PI * 2);
        ctx.fillStyle = mark.fillColor;
        ctx.globalAlpha = mark.opacity ?? 1;
        ctx.fill();
      }
      await StudioRuntime.yieldToInput(job);
      return await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed. Try a smaller size.')), 'image/png');
      });
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  class ArtworkExport {
    constructor(getScene) {
      this.getScene = getScene;
      this.dialog = document.getElementById('exportDialog');
      this.trigger = document.getElementById('exportButton');
      this.download = document.getElementById('exportDownloadButton');
      this.share = document.getElementById('exportShareButton');
      this.resolution = document.getElementById('exportResolution');
      this.status = document.getElementById('exportDialogStatus');
      this.file = null;
      this.job = null;
      this.sharing = false;
      this.shareable = false;
      this.trigger.addEventListener('click', () => this.open());
      document.getElementById('exportCloseButton').addEventListener('click', () => this.close());
      this.dialog.addEventListener('close', () => this.release());
      this.dialog.addEventListener('cancel', event => {
        event.preventDefault();
        this.close();
      });
      this.dialog.addEventListener('click', event => {
        if (event.target !== this.dialog) return;
        const bounds = this.dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) this.close();
      });
      this.dialog.querySelectorAll('input[name="exportFormat"]').forEach(input => {
        input.addEventListener('change', () => this.prepare());
      });
      this.resolution.addEventListener('change', () => this.prepare());
      this.download.addEventListener('click', () => {
        if (!this.file || this.sharing) return;
        try {
          save(this.file, this.file.name);
          this.message('Download started.');
        } catch (error) {
          console.error('Artwork download:', error);
          this.message(error.message, 'error');
        }
      });
      this.share.addEventListener('click', () => this.shareFile());
    }

    message(text, tone = 'normal') {
      this.status.textContent = text;
      this.status.dataset.tone = tone;
    }

    cancelPreparation() {
      if (this.job) this.job.cancelled = true;
    }

    close() {
      this.dialog.close();
      this.release();
    }

    release() {
      if (this.dialog.open || !this.scene) return;
      this.cancelPreparation();
      this.file = null;
      this.shareable = false;
      this.scene = null;
      document.dispatchEvent(new Event('studio-export-closed'));
      this.trigger.focus({ preventScroll: true });
    }

    open() {
      const scene = this.getScene();
      if (!scene) return;
      this.scene = scene;
      this.dialog.showModal();
      document.dispatchEvent(new Event('studio-export-opened'));
      this.prepare();
    }

    async prepare() {
      if (!this.dialog.open || !this.scene) return;
      this.cancelPreparation();
      const job = { cancelled: false };
      this.job = job;
      this.file = null;
      this.shareable = false;
      this.download.disabled = this.share.disabled = true;
      const format = this.dialog.querySelector('input[name="exportFormat"]:checked').value;
      const scene = this.scene;
      document.getElementById('exportResolutionField').hidden = format !== 'png';
      const canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
      this.share.hidden = !canShare;
      this.message(`Preparing ${format.toUpperCase()}...`);
      document.getElementById('exportSize').textContent = '';
      try {
        if (format === 'png') {
          const size = pngSize(scene, this.resolution.value);
          document.getElementById('exportSize').textContent =
            `${size.width.toLocaleString()} x ${size.height.toLocaleString()} px / ${(size.width * size.height * 4 / 1048576).toFixed(1)} MiB render buffer`;
        } else document.getElementById('exportSize').textContent = 'Vector artwork · scales to any size';
        await StudioRuntime.yieldToInput(job);
        const blob = format === 'svg' ? new Blob([svgText(scene)], { type: 'image/svg+xml' }) :
          await pngBlob(scene, this.resolution.value, job);
        if (job.cancelled || !this.dialog.open || this.job !== job) return;
        this.file = new File([blob], `stipple_art.${format}`, { type: blob.type });
        this.download.disabled = this.sharing;
        const shareable = canShare && navigator.canShare({ files: [this.file] });
        this.shareable = shareable;
        this.share.disabled = !shareable || this.sharing;
        this.message(shareable ? 'Ready to download or share.' : canShare ?
          'Ready to download. Sharing this format is unavailable on this device.' : 'Ready to download.');
      } catch (error) {
        if (job.cancelled || this.job !== job || !this.dialog.open) return;
        console.error('Artwork export:', error);
        this.message(error.message, 'error');
      }
    }

    async shareFile() {
      if (!this.file || this.sharing) return;
      const job = this.job;
      this.sharing = true;
      this.download.disabled = this.share.disabled = true;
      this.dialog.querySelectorAll('input, select').forEach(input => { input.disabled = true; });
      try {
        // The prepared File lets this call retain the original user gesture.
        await navigator.share({ files: [this.file], title: 'Stipple art' });
        if (this.dialog.open && this.job === job) this.message('Artwork shared.');
      } catch (error) {
        if (error.name === 'AbortError') {
          if (this.dialog.open && this.job === job) this.message('Sharing cancelled. Your download is still ready.');
        }
        else {
          console.error('Artwork sharing:', error);
          if (this.dialog.open && this.job === job) this.message(`${error.message} You can still download the file.`, 'error');
        }
      } finally {
        this.sharing = false;
        this.dialog.querySelectorAll('input, select').forEach(input => { input.disabled = false; });
        if (this.dialog.open && this.file) {
          this.download.disabled = false;
          this.share.disabled = !this.shareable;
        }
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { pngSize, svgText, pngBlob };
  else globalThis.ArtworkExport = ArtworkExport;
})();
