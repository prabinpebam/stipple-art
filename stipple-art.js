// stipple-art.js
// This script implements a weighted Voronoi stippling algorithm with adjustable parameters,
// optional dot colorization, continuous animation, and drag-and-drop image upload.
document.addEventListener("DOMContentLoaded", function() {
  const canvas = document.getElementById('stippleCanvas');
  const renderer = new PreviewRenderer(canvas);
  const imageUpload = document.getElementById('imageUpload');
  const randomSeedInput = document.getElementById('randomSeed');
  const generateButton = document.getElementById('generateButton');
  const exportButton = document.getElementById('exportButton');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const progressBar = document.getElementById('progressBar');
  const progressValue = document.getElementById('progressValue');
  const stage = document.getElementById('renderArea');
  const particles = new ParticleField();
  const particleAudio = new ParticleAudio();
  let audioFocused = true;
  const viewport = new PreviewViewport(stage, canvas, (view, timestamp) => {
    const animate = particles.advance(timestamp, { ...view, width: stage.clientWidth, height: stage.clientHeight });
    if (audioFocused) particleAudio.update(particles.motion, stage.clientWidth);
    renderer.render(view, particles.enabled ? particles.offsets : null);
    return animate;
  });
  const settingsForm = document.getElementById('settingsForm');
  const stopButton = document.getElementById('stopButton');
  const status = document.getElementById('studioStatus');
  canvas.addEventListener('preview-render-error', event => showStatus(event.detail, 'error'));
  canvas.addEventListener('preview-render-restored', () => {
    viewport.schedule();
    showStatus('Preview graphics restored.');
  });
  const artworkTokens = getComputedStyle(document.documentElement);
  const inkLight = artworkTokens.getPropertyValue('--cp-ink-light').trim();
  const inkDark = artworkTokens.getPropertyValue('--cp-ink-dark').trim();
  const paperLight = artworkTokens.getPropertyValue('--cp-paper-light').trim();
  const paperDark = artworkTokens.getPropertyValue('--cp-paper-dark').trim();

  // Parameter controls.
  const stippleCountInput = document.getElementById('stippleCount');
  const iterationCountSlider = document.getElementById('iterationCount');
  const minDotSizeSlider = document.getElementById('minDotSize');
  const dotSizeRangeSlider = document.getElementById('dotSizeRange');
  const whiteCutoffSlider = document.getElementById('whiteCutoff');
  const sampleCountSlider = document.getElementById('sampleCount');
  const colorizeDotsSwitch = document.getElementById('colorizeDots');
  const animateVoronoiSwitch = document.getElementById('animateVoronoi');
  const mouseInteractionSwitch = document.getElementById('mouseInteraction');
  const soundSwitch = document.getElementById('particleSound');
  let audioUnlocking = false;
  async function unlockParticleSound() {
    if (!soundSwitch.checked || audioUnlocking ||
        (particleAudio.enabled && particleAudio.context.state === 'running')) return;
    audioUnlocking = true;
    try {
      await particleAudio.enable();
      viewport.schedule();
    } catch (error) {
      console.error('Particle sound:', error);
      soundSwitch.checked = false;
      particleAudio.enabled = false;
      particleAudio.silence();
      showStatus(error.message, 'error');
    } finally {
      audioUnlocking = false;
    }
  }
  // Unlock default-on audio through an actual gesture, not autoplay.
  document.addEventListener('pointerdown', event => {
    if (event.target !== soundSwitch) unlockParticleSound();
  });
  document.addEventListener('keydown', event => {
    if (event.target !== soundSwitch) unlockParticleSound();
  });
  soundSwitch.addEventListener('change', async () => {
    try {
      if (soundSwitch.checked) {
        await unlockParticleSound();
      } else {
        await particleAudio.disable();
      }
    } catch (error) {
      console.error('Particle sound:', error);
      soundSwitch.checked = false;
      particleAudio.enabled = false;
      particleAudio.silence();
      showStatus(error.message, 'error');
    }
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const shapeInputs = settingsForm.querySelectorAll('input[name="shapeOption"]');
  const orientationInputs = settingsForm.querySelectorAll('input[name="orientationOption"]');
  const shapeAngleSlider = document.getElementById('shapeAngle');

  // Default: White on Black.
  let currentStippleColor = 'white';
  let image = null;
  let stipplePoints = []; // Array of { x, y } in image coordinate space.
  let globalImgData = null; // Bounded working-resolution image pixel data.
  let animationFrameID = null;
  let busyMode = null;
  let generationJob = null;
  let cellAngles = null;
  let renderedArtwork = null;
  let sourceFile = null;
  let appliedResolution = importOption('resolutionOption');
  let hasTransparency = false;
  const importControls = document.querySelectorAll('input[name="resolutionOption"]');
  const cancelButton = document.getElementById('cancelButton');
  const artworkExport = new ArtworkExport(() => renderedArtwork);
  document.addEventListener('studio-export-opened', () => {
    viewport.endGesture();
    syncMouseInteraction();
    particleAudio.silence();
    viewport.schedule();
  });
  document.addEventListener('studio-export-closed', () => {
    syncMouseInteraction();
    viewport.schedule();
  });
  canvas.addEventListener('particle-touch', event => {
    if (!particles.enabled) return;
    particles.move(event.detail.point.x, event.detail.point.y, event.detail.timestamp);
    viewport.schedule();
  });
  canvas.addEventListener('particle-touch-end', () => particles.leave());
  document.addEventListener('studio-view-change', () => {
    syncMouseInteraction();
    particleAudio.silence();
    viewport.schedule();
  });

  function syncMouseInteraction() {
    mouseInteractionSwitch.disabled = Boolean(busyMode) || reducedMotion.matches;
    mouseInteractionSwitch.title = reducedMotion.matches ? 'Disabled by your reduced-motion preference.' :
      'Move over the artwork to scatter shapes. Preview only.';
    const enabled = mouseInteractionSwitch.checked && !busyMode && !reducedMotion.matches &&
      !document.getElementById('previewWorkspace').inert && !artworkExport.dialog.open && Boolean(renderedArtwork);
    if (particles.enabled !== enabled) particles.setEnabled(enabled);
    if (!enabled) particleAudio.silence();
  }
  mouseInteractionSwitch.addEventListener('change', () => {
    syncMouseInteraction();
    viewport.schedule();
  });
  reducedMotion.addEventListener('change', () => {
    syncMouseInteraction();
    viewport.schedule();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || event.buttons || viewport.pointers.size || !particles.enabled) return;
    const point = viewport.localPoint(event);
    particles.move(point.x, point.y, event.timeStamp);
    viewport.schedule();
  });
  ['pointerleave', 'pointercancel', 'wheel', 'dblclick'].forEach(type => {
    canvas.addEventListener(type, () => particles.leave(), { passive: true });
  });
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') particles.leave();
  });
  stage.addEventListener('keydown', () => particles.leave());
  window.addEventListener('blur', () => {
    audioFocused = false;
    particles.leave();
    particleAudio.silence();
  });
  window.addEventListener('focus', () => { audioFocused = true; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      particleAudio.silence();
      particles.reset(particles.marks);
      if (viewport.frame !== null) cancelAnimationFrame(viewport.frame);
      viewport.frame = null;
      particleAudio.disable().catch(error => {
        console.error('Could not suspend background audio:', error);
        showStatus('Could not suspend background audio. Turn Sound off.', 'error');
      });
      if (busyMode === 'animation') stopButton.click();
    } else {
      viewport.schedule();
    }
  });
  syncMouseInteraction();

  function importOption(name) {
    return Array.from(settingsForm.elements).find(input => input.name === name && input.checked).value;
  }

  function updateResolutionState() {
    const labels = { '1024': 'Fast · 1K', '2048': 'Balanced · 2K', '4096': 'Detail · 4K' };
    const label = labels[importOption('resolutionOption')];
    document.getElementById('resolutionState').textContent = label;
    document.getElementById('resolutionCompact').textContent = `${Number(importOption('resolutionOption')) / 1024}K`;
    document.getElementById('resolutionButton').setAttribute('aria-label', `Working resolution: ${label}. Open settings.`);
  }
  updateResolutionState();

  function selectedShape() {
    return settingsForm.querySelector('input[name="shapeOption"]:checked').value;
  }

  function selectedOrientation() {
    return settingsForm.querySelector('input[name="orientationOption"]:checked').value;
  }

  function syncOrientationControls() {
    const isDot = selectedShape() === 'dot';
    const mode = selectedOrientation();
    document.getElementById('orientationControls').hidden = isDot;
    document.getElementById('shapeAngleField').hidden = mode !== 'fixed';
    orientationInputs.forEach(input => { input.disabled = Boolean(busyMode) || isDot; });
    shapeAngleSlider.disabled = Boolean(busyMode) || isDot || mode !== 'fixed';
    document.getElementById('orientationHint').textContent = mode === 'random' ?
      'Seeded rotations stay stable as the shapes move or resize.' : mode === 'voronoi' ?
      "Follow each cell's longest axis as the pattern evolves." : 'Rotate every shape by the same angle.';
  }

  function showStatus(message, tone = 'normal') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setBusy(mode) {
    busyMode = mode;
    Array.from(settingsForm.elements).forEach(input => {
      if (input.tagName === 'INPUT') input.disabled = Boolean(mode);
    });
    updateResolutionState();
    syncOrientationControls();
    syncMouseInteraction();
    generateButton.disabled = Boolean(mode) || !image;
    generateButton.hidden = mode === 'static' || mode === 'animation';
    exportButton.disabled = mode === 'loading' || mode === 'static' || !stipplePoints.length;
    cancelButton.hidden = mode !== 'static';
    if (mode === 'static') cancelButton.disabled = false;
    stopButton.hidden = mode !== 'animation';
    stage.classList.toggle('is-busy', Boolean(mode));
    stage.setAttribute('aria-busy', String(Boolean(mode)));
    viewport.setEnabled(Boolean(image) && mode !== 'loading');
    document.getElementById('previewState').textContent = mode === 'loading' ? 'Loading image' :
      mode === 'static' ? 'Refining dots' : mode === 'animation' ? 'Animating' :
      stipplePoints.length ? `${stipplePoints.length.toLocaleString()} dots` : image ? 'Image ready' : 'No image yet';
  }
  syncOrientationControls();

  function reportError(error) {
    console.error('Stipple Studio:', error);
    progressBarContainer.hidden = true;
    imageUpload.value = '';
    renderStippleArt();
    setBusy(null);
    showStatus(error.message, 'error');
  }
  
  // Resize canvas to fill renderArea.
  function resizeCanvas() {
    const sizeChanged = viewport.width !== stage.clientWidth || viewport.height !== stage.clientHeight;
    viewport.resize();
    renderer.resize(stage.clientWidth, stage.clientHeight);
    if (sizeChanged || !renderer.scene) renderStippleArt();
  }
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(stage);
  let densityQuery;
  function watchPixelDensity() {
    if (densityQuery) densityQuery.removeEventListener('change', updatePixelDensity);
    densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    densityQuery.addEventListener('change', updatePixelDensity);
  }
  function updatePixelDensity() {
    renderer.resize(stage.clientWidth, stage.clientHeight);
    viewport.schedule();
    watchPixelDensity();
  }
  watchPixelDensity();
  
  // Seedable RNG.
  function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  }
  
  function updateProgress(percent) {
    progressBar.style.width = percent + '%';
    progressBar.setAttribute('aria-valuenow', percent);
    progressValue.textContent = percent + '%';
  }
  
  // Get brightness from imageData.
  function getBrightness(x, y, imageData, width) {
    const height = imageData.length / (width * 4);
    const idx = (Math.min(height - 1, Math.max(0, Math.floor(y))) * width + Math.min(width - 1, Math.max(0, Math.floor(x)))) * 4;
    const r = imageData[idx], g = imageData[idx+1], b = imageData[idx+2];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  
  // Get color from imageData.
  function getColor(x, y, imageData, width) {
    const height = imageData.length / (width * 4);
    const idx = (Math.min(height - 1, Math.max(0, Math.floor(y))) * width + Math.min(width - 1, Math.max(0, Math.floor(x)))) * 4;
    return { r: imageData[idx], g: imageData[idx+1], b: imageData[idx+2], alpha: imageData[idx+3] / 255 };
  }
  
  // Compute weighted centroid using Monte Carlo sampling.
  function computeWeightedCentroid(polygon, imageData, imgWidth, sampleCount) {
    const [minX, minY, maxX, maxY] = polygon.reduce(([minX, minY, maxX, maxY], point) => {
      return [Math.min(minX, point[0]), Math.min(minY, point[1]), Math.max(maxX, point[0]), Math.max(maxY, point[1])];
    }, [Infinity, Infinity, -Infinity, -Infinity]);
    let sumX = 0, sumY = 0, sumW = 0;
    for (let i = 0; i < sampleCount; i++) {
      const rx = minX + Math.random() * (maxX - minX);
      const ry = minY + Math.random() * (maxY - minY);
      if (d3.polygonContains(polygon, [rx, ry])) {
        let brightness = getBrightness(rx, ry, imageData, imgWidth);
        const weight = ((currentStippleColor === 'white') ? (brightness/255) : (1 - brightness/255)) *
          getColor(rx, ry, imageData, imgWidth).alpha;
        sumX += rx * weight;
        sumY += ry * weight;
        sumW += weight;
      }
    }
    return sumW === 0 ? null : [sumX / sumW, sumY / sumW];
  }
  
  async function initializePoints(seed, job) {
    if (!window.d3 || !d3.Delaunay || !d3.polygonContains) {
      throw new Error('The drawing libraries could not load. Check your connection and reload the page.');
    }
    const rng = mulberry32(seed);
    const orientationRng = mulberry32(seed ^ 0x9E3779B9);
    const desiredCount = Number(stippleCountInput.value);
    if (!Number.isSafeInteger(desiredCount) || desiredCount < 1 || desiredCount > 100000) {
      throw new Error('Enter between 1 and 100,000 marks.');
    }
    const whiteCutoff = parseFloat(whiteCutoffSlider.value);
    if (whiteCutoff >= 1) {
      throw new Error('Lower the brightness cutoff below 1 to allow dots to be placed.');
    }
    currentStippleColor = document.querySelector('input[name="colorOption"]:checked').value;

    // Bound rejection sampling so blank images or a cutoff of 1 cannot freeze the UI.
    const points = [];
    const maxAttempts = desiredCount * 100;
    for (let attempts = 0; points.length < desiredCount && attempts < maxAttempts; attempts++) {
      if (attempts % 4096 === 0) await StudioRuntime.yieldToInput(job);
      const x = rng() * image.width;
      const y = rng() * image.height;
      const brightness = getBrightness(x, y, globalImgData, image.width);
      const weight = currentStippleColor === 'white' ? brightness / 255 : 1 - brightness / 255;
      if (weight > whiteCutoff && rng() < weight * getColor(x, y, globalImgData, image.width).alpha) {
        points.push({ x, y, randomAngle: orientationRng() * 2 * Math.PI });
      }
    }
    if (points.length < desiredCount) {
      stipplePoints = [];
      throw new Error('Not enough image contrast to place the dots. Lower the brightness cutoff or switch ink & paper.');
    }
    stipplePoints = points;
    cellAngles = null;
  }

  async function refinePoints(sampleCount, job) {
    await StudioRuntime.yieldToInput(job);
    const delaunay = d3.Delaunay.from(stipplePoints.map(pt => [pt.x, pt.y]));
    const voronoi = delaunay.voronoi([0, 0, image.width, image.height]);
    const nextPoints = [];
    let deadline = performance.now() + 8;
    for (let i = 0; i < stipplePoints.length; i++) {
      if (performance.now() >= deadline) {
        await StudioRuntime.yieldToInput(job);
        deadline = performance.now() + 8;
      }
      const pt = stipplePoints[i];
      const cell = voronoi.cellPolygon(i);
      const centroid = cell ? computeWeightedCentroid(cell, globalImgData, image.width, sampleCount) : null;
      if (centroid && getColor(centroid[0], centroid[1], globalImgData, image.width).alpha !== 0) {
        nextPoints.push({ ...pt, x: centroid[0], y: centroid[1] });
      } else nextPoints.push(pt);
    }
    await StudioRuntime.yieldToInput(job);
    stipplePoints = nextPoints;
    cellAngles = null;
  }

  async function generateStippleArt(seed, job) {
      const iterations = Number(iterationCountSlider.value);
      const sampleCount = Number(sampleCountSlider.value);
      updateProgress(0);
      progressBarContainer.hidden = false;
      await initializePoints(seed, job);
      for (let currentIteration = 1; currentIteration <= iterations; currentIteration++) {
          await refinePoints(sampleCount, job);
          updateProgress(Math.floor(currentIteration / iterations * 100));
          renderStippleArt();
      }
      progressBarContainer.hidden = true;
  }

  // Animation mode: continuously iterate at ~12 fps.
  async function animateVoronoi(seed, job) {
    await initializePoints(seed, job);
    renderStippleArt();
    setBusy('animation');
    const sampleCount = Number(sampleCountSlider.value);
    
    let lastIterationTime = 0;
    async function animateIteration(timestamp) {
      try {
        if (!lastIterationTime) lastIterationTime = timestamp;
        if (timestamp - lastIterationTime >= 80) {
          await refinePoints(sampleCount, job);
          renderStippleArt();
          lastIterationTime = timestamp;
        }
        animationFrameID = requestAnimationFrame(animateIteration);
      } catch (error) {
        if (generationJob === job) {
          animationFrameID = null;
          if (error.name !== 'AbortError') reportError(error);
        }
      }
    }
    animationFrameID = requestAnimationFrame(animateIteration);
  }
  
  function markColor(pt, radius, scale) {
    const ink = currentStippleColor === 'white' ? inkLight : inkDark;
    if (!colorizeDotsSwitch.checked) return ink;
    const imageRadius = radius / scale;
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.random() * imageRadius;
      const sampleX = pt.x + r * Math.cos(angle);
      const sampleY = pt.y + r * Math.sin(angle);
      if (sampleX >= 0 && sampleX < image.width && sampleY >= 0 && sampleY < image.height) {
        const col = getColor(sampleX, sampleY, globalImgData, image.width);
        sumR += col.r * col.alpha;
        sumG += col.g * col.alpha;
        sumB += col.b * col.alpha;
        count += col.alpha;
      }
    }
    return count ? `rgb(${Math.round(sumR / count)}, ${Math.round(sumG / count)}, ${Math.round(sumB / count)})` : ink;
  }

  function createRenderMarks(scale, offsetX, offsetY) {
    const minSize = Number(minDotSizeSlider.value);
    const sizeRange = Number(dotSizeRangeSlider.value);
    const shape = selectedShape();
    const mode = selectedOrientation();
    const fixedAngle = Number(shapeAngleSlider.value) * Math.PI / 180;
    if (shape !== 'dot' && mode === 'voronoi' && !cellAngles) {
      const delaunay = d3.Delaunay.from(stipplePoints.map(pt => [pt.x, pt.y]));
      const voronoi = delaunay.voronoi([0, 0, image.width, image.height]);
      cellAngles = stipplePoints.map((_, i) => StippleGeometry.cellOrientation(voronoi.cellPolygon(i)));
    }
    return stipplePoints.map((pt, i) => {
      const brightness = getBrightness(pt.x, pt.y, globalImgData, image.width) / 255;
      const weight = currentStippleColor === 'white' ? brightness : 1 - brightness;
      const radius = minSize + weight * sizeRange;
      const cx = offsetX + pt.x * scale, cy = offsetY + pt.y * scale;
      const alignedAngle = shape !== 'dot' && mode === 'voronoi' ?
        cellAngles[i] + (shape === 'triangle' ? Math.PI / 2 : 0) : 0;
      const angle = mode === 'random' ? pt.randomAngle : mode === 'voronoi' ? alignedAngle : fixedAngle;
      return {
        cx, cy, radius, opacity: getColor(pt.x, pt.y, globalImgData, image.width).alpha,
        vertices: shape === 'dot' ? null : StippleGeometry.polygonVertices(shape, cx, cy, radius, angle),
        fillColor: markColor(pt, radius, scale)
      };
    });
  }

  // Retain the exact rendered geometry and colors for SVG export.
  function renderStippleArt() {
    renderedArtwork = null;
    stage.dataset.paper = currentStippleColor === 'white' ? 'dark' : 'light';
    stage.classList.toggle('has-image', Boolean(image));
    document.getElementById('emptyState').hidden = Boolean(image);
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!image || !width || !height) {
      particles.reset([]);
      syncMouseInteraction();
      renderer.setScene(null);
      viewport.schedule();
      return;
    }
    const scale = Math.min(width / image.width, height / image.height);
    const offsetX = (width - image.width * scale) / 2;
    const offsetY = (height - image.height * scale) / 2;
    if (!stipplePoints.length) {
      particles.reset([]);
      syncMouseInteraction();
      renderer.setScene({ width, height, image, offsetX, offsetY, renderWidth: image.width * scale, renderHeight: image.height * scale });
      viewport.schedule();
      return;
    }
    const background = hasTransparency ? 'transparent' : currentStippleColor === 'white' ? paperDark : paperLight;
    const marks = createRenderMarks(scale, offsetX, offsetY);
    renderedArtwork = {
      width, height, background, marks,
      offsetX, offsetY, renderWidth: image.width * scale, renderHeight: image.height * scale
    };
    particles.reset(marks);
    syncMouseInteraction();
    renderer.setScene(renderedArtwork);
    viewport.schedule();
  }
  
  
  // Handle image upload and drag-and-drop.
  async function handleImageFile(file) {
    if (busyMode) {
      showStatus('Finish generation or stop the animation before replacing your image.', 'error');
      return;
    }
    setBusy('loading');
    showStatus('Decoding and resizing your image locally...');
    const resolution = importOption('resolutionOption');
    try {
      const prepared = await ImageImport.prepare(file, Number(resolution));
      const previous = image;
      image = prepared.canvas;
      globalImgData = prepared.pixels;
      sourceFile = file;
      appliedResolution = resolution;
      hasTransparency = prepared.hasTransparency;
      viewport.reset();
      stipplePoints = [];
      cellAngles = null;
      if (previous) { previous.width = 0; previous.height = 0; }
      document.getElementById('imageFileName').textContent = file.name;
      document.getElementById('imageFileName').title = file.name;
      document.getElementById('uploadHint').textContent = 'Click to replace your image';
      document.getElementById('previewTitle').textContent = file.name;
      document.getElementById('previewTitle').title = file.name;
      const original = `${prepared.originalWidth.toLocaleString()} x ${prepared.originalHeight.toLocaleString()}`;
      const working = `${image.width.toLocaleString()} x ${image.height.toLocaleString()}`;
      document.getElementById('imageDimensions').textContent = `${working} px working`;
      const resized = prepared.originalWidth !== image.width || prepared.originalHeight !== image.height;
      document.getElementById('importDetails').textContent =
        `${original} px source → ${working} px working · ${(prepared.bytes / 1048576).toFixed(1)} MiB file · ` +
        `${(prepared.pixels.byteLength / 1048576).toFixed(1)} MiB pixel data · ${prepared.type}. ` +
        (resized ? 'Downsampled to keep processing bounded. ' : 'Original dimensions retained. ') +
        (hasTransparency ? 'Transparency preserved. ' : '') +
        'Animated images use a single still frame.';
      imageUpload.value = '';
      renderStippleArt();
      setBusy(null);
      showStatus(resized ? 'Large image resized. Preview ready; adjust the details, then generate.' :
        'Image ready. Adjust the details, then generate.');
    } catch (error) {
      document.querySelector(`input[name="resolutionOption"][value="${appliedResolution}"]`).checked = true;
      reportError(error);
    }
  }

  importControls.forEach(input => {
    input.addEventListener('change', () => {
      updateResolutionState();
      if (sourceFile) handleImageFile(sourceFile);
    });
  });
  
  imageUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
  });
  
  stage.addEventListener('drop', function(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });
  
  settingsForm.addEventListener('submit', function(event) {
    event.preventDefault();
    if (busyMode) return;
    if (!image) { showStatus('Choose an image to get started.', 'error'); return; }
    if (!settingsForm.reportValidity()) return;
    const seed = Number(randomSeedInput.value);
    if (!Number.isSafeInteger(seed)) {
      showStatus('Enter a whole-number seed within the safe integer range.', 'error');
      return;
    }
    document.dispatchEvent(new Event('studio-show-preview'));
    const job = { cancelled: false };
    generationJob = job;
    const previousPoints = stipplePoints;
    setBusy('static');
    if (animateVoronoiSwitch.checked) {
        animateVoronoi(seed, job).then(() => {
        showStatus('Your pattern is evolving. Stop when it feels right.');
        }).catch(error => finishGenerationError(error, previousPoints, job));
    } else {
      showStatus('Refining your dots...');
      generateStippleArt(seed, job)
        .then(() => {
          setBusy(null);
          showStatus('Artwork ready. Fine-tune the appearance or export your SVG.');
        })
        .catch(error => finishGenerationError(error, previousPoints, job));
    }
  });
  settingsForm.addEventListener('invalid', () => {
    document.dispatchEvent(new Event('studio-show-settings'));
  }, true);

  stopButton.addEventListener('click', () => {
    if (generationJob) generationJob.cancelled = true;
    if (animationFrameID) cancelAnimationFrame(animationFrameID);
    animationFrameID = null;
    setBusy(null);
    showStatus('Animation stopped. Your artwork is ready to export.');
  });
  cancelButton.addEventListener('click', () => {
    if (busyMode !== 'static' || !generationJob) return;
    if (generationJob) generationJob.cancelled = true;
    cancelButton.disabled = true;
    showStatus('Cancelling generation...');
  });
  function finishGenerationError(error, previousPoints, job) {
    if (generationJob !== job) return;
    if (error.name === 'AbortError') {
      console.info('Stipple Studio: generation cancelled by user.');
      stipplePoints = previousPoints;
      cellAngles = null;
      progressBarContainer.hidden = true;
      renderStippleArt();
      setBusy(null);
      cancelButton.disabled = false;
      showStatus('Generation cancelled.');
    } else reportError(error);
  }

  [...shapeInputs, ...orientationInputs].forEach(input => {
    input.addEventListener('change', () => {
      syncOrientationControls();
      renderStippleArt();
    });
  });
  [minDotSizeSlider, dotSizeRangeSlider, colorizeDotsSwitch, shapeAngleSlider].forEach(input => {
    input.addEventListener('input', renderStippleArt);
  });
  settingsForm.querySelectorAll('input[name="colorOption"]').forEach(input => {
    input.addEventListener('change', () => {
      currentStippleColor = input.value;
      renderStippleArt();
      if (stipplePoints.length) showStatus('Ink updated. Generate again to redistribute the dots for this paper.');
    });
  });
  
});
