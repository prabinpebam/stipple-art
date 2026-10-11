// stipple-art.js
// This script implements a weighted Voronoi stippling algorithm with adjustable parameters,
// optional dot colorization, continuous animation, and drag-and-drop image upload.
document.addEventListener("DOMContentLoaded", function() {
  const canvas = document.getElementById('stippleCanvas');
  const ctx = canvas.getContext('2d');
  const imageUpload = document.getElementById('imageUpload');
  const randomSeedInput = document.getElementById('randomSeed');
  const generateButton = document.getElementById('generateButton');
  const downloadSVGButton = document.getElementById('downloadSVGButton');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const progressBar = document.getElementById('progressBar');
  const progressValue = document.getElementById('progressValue');
  const stage = document.getElementById('renderArea');
  const viewport = new PreviewViewport(stage, canvas);
  const settingsForm = document.getElementById('settingsForm');
  const stopButton = document.getElementById('stopButton');
  const status = document.getElementById('studioStatus');
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
  const shapeInputs = settingsForm.querySelectorAll('input[name="shapeOption"]');
  const orientationInputs = settingsForm.querySelectorAll('input[name="orientationOption"]');
  const shapeAngleSlider = document.getElementById('shapeAngle');

  // Default: White on Black.
  let currentStippleColor = 'white';
  let image = null;
  let stipplePoints = []; // Array of { x, y } in image coordinate space.
  let globalImgData = null; // Full-resolution image pixel data.
  let animationFrameID = null;
  let busyMode = null;
  let cellAngles = null;
  let renderedArtwork = null;

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
    settingsForm.querySelectorAll('input').forEach(input => { input.disabled = Boolean(mode); });
    syncOrientationControls();
    generateButton.disabled = Boolean(mode) || !image;
    downloadSVGButton.disabled = mode === 'loading' || mode === 'static' || !stipplePoints.length;
    stopButton.hidden = mode !== 'animation';
    stage.classList.toggle('is-busy', Boolean(mode));
    stage.setAttribute('aria-busy', String(Boolean(mode)));
    viewport.setEnabled(Boolean(image) && mode !== 'loading');
    document.getElementById('previewState').textContent = mode === 'loading' ? 'Loading image' :
      mode === 'static' ? 'Refining dots' : mode === 'animation' ? 'Animating' :
      stipplePoints.length ? `${stipplePoints.length.toLocaleString()} marks` : image ? 'Image ready' : 'No image yet';
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
    viewport.resize();
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;
    renderStippleArt();
  }
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(stage);
  
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
    return { r: imageData[idx], g: imageData[idx+1], b: imageData[idx+2] };
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
        const weight = (currentStippleColor === 'white') ? (brightness/255) : (1 - brightness/255);
        sumX += rx * weight;
        sumY += ry * weight;
        sumW += weight;
      }
    }
    return sumW === 0 ? polygon[0] : [sumX / sumW, sumY / sumW];
  }
  
  function initializePoints(seed) {
    if (!window.d3 || !d3.Delaunay || !d3.polygonContains) {
      throw new Error('The drawing libraries could not load. Check your connection and reload the page.');
    }
    const rng = mulberry32(seed);
    const orientationRng = mulberry32(seed ^ 0x9E3779B9);
    const desiredCount = Number(stippleCountInput.value);
    if (!Number.isSafeInteger(desiredCount) || desiredCount < 1) {
      throw new Error('Enter a positive whole number of dots.');
    }
    const whiteCutoff = parseFloat(whiteCutoffSlider.value);
    if (whiteCutoff >= 1) {
      throw new Error('Lower the brightness cutoff below 1 to allow dots to be placed.');
    }
    currentStippleColor = document.querySelector('input[name="colorOption"]:checked').value;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = image.width;
    offCanvas.height = image.height;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(image, 0, 0);
    globalImgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height).data;

    // Bound rejection sampling so blank images or a cutoff of 1 cannot freeze the UI.
    const points = [];
    const maxAttempts = desiredCount * 100;
    for (let attempts = 0; points.length < desiredCount && attempts < maxAttempts; attempts++) {
      const x = rng() * image.width;
      const y = rng() * image.height;
      const brightness = getBrightness(x, y, globalImgData, image.width);
      const weight = currentStippleColor === 'white' ? brightness / 255 : 1 - brightness / 255;
      if (weight > whiteCutoff && rng() < weight) {
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

  function refinePoints(sampleCount) {
    const delaunay = d3.Delaunay.from(stipplePoints.map(pt => [pt.x, pt.y]));
    const voronoi = delaunay.voronoi([0, 0, image.width, image.height]);
    stipplePoints = stipplePoints.map((pt, i) => {
      const cell = voronoi.cellPolygon(i);
      if (!cell) return pt;
      const [x, y] = computeWeightedCentroid(cell, globalImgData, image.width, sampleCount);
      return { ...pt, x, y };
    });
    cellAngles = null;
  }

  function generateStippleArt(seed) {
    return new Promise((resolve, reject) => {
      const iterations = Number(iterationCountSlider.value);
      const sampleCount = Number(sampleCountSlider.value);
      let currentIteration = 0;
      updateProgress(0);
      progressBarContainer.hidden = false;
      function iterate() {
        try {
          if (currentIteration === 0) initializePoints(seed);
          refinePoints(sampleCount);
          currentIteration++;
          updateProgress(Math.floor(currentIteration / iterations * 100));
          renderStippleArt();
          if (currentIteration < iterations) {
            requestAnimationFrame(iterate);
          } else {
            progressBarContainer.hidden = true;
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      }
      requestAnimationFrame(iterate);
    });
  }

  // Animation mode: continuously iterate at ~12 fps.
  function animateVoronoi(seed) {
    initializePoints(seed);
    renderStippleArt();
    setBusy('animation');
    const sampleCount = Number(sampleCountSlider.value);
    
    let lastIterationTime = 0;
    function animateIteration(timestamp) {
      try {
        if (!lastIterationTime) lastIterationTime = timestamp;
        if (timestamp - lastIterationTime >= 80) {
          refinePoints(sampleCount);
          renderStippleArt();
          lastIterationTime = timestamp;
        }
        animationFrameID = requestAnimationFrame(animateIteration);
      } catch (error) {
        animationFrameID = null;
        reportError(error);
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
        sumR += col.r;
        sumG += col.g;
        sumB += col.b;
        count++;
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
        cx, cy, radius,
        vertices: shape === 'dot' ? null : StippleGeometry.polygonVertices(shape, cx, cy, radius, angle),
        fillColor: markColor(pt, radius, scale)
      };
    });
  }

  // Retain the exact rendered geometry and colors for SVG export.
  function renderStippleArt() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderedArtwork = null;
    document.getElementById('emptyState').hidden = Boolean(image);
    if (!image || !canvas.width || !canvas.height) return;
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const offsetX = (canvas.width - image.width * scale) / 2;
    const offsetY = (canvas.height - image.height * scale) / 2;
    if (!stipplePoints.length) {
      ctx.drawImage(image, offsetX, offsetY, image.width * scale, image.height * scale);
      return;
    }
    const background = currentStippleColor === 'white' ? paperDark : paperLight;
    const marks = createRenderMarks(scale, offsetX, offsetY);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    marks.forEach(mark => {
      ctx.beginPath();
      if (mark.vertices) {
        mark.vertices.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      } else {
        ctx.arc(mark.cx, mark.cy, mark.radius, 0, 2 * Math.PI);
      }
      ctx.fillStyle = mark.fillColor;
      ctx.fill();
    });
    renderedArtwork = { width: canvas.width, height: canvas.height, background, marks };
  }
  
  // Download as SVG.
  function downloadSVG() {
    try {
      if (!renderedArtwork) {
        throw new Error('Generate stipple art before exporting.');
      }
      const { width, height, background, marks } = renderedArtwork;
      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
      svgContent += `<rect width="100%" height="100%" fill="${background}"/>`;
      marks.forEach(mark => {
        if (mark.vertices) {
          const points = mark.vertices.map(vertex => vertex.join(',')).join(' ');
          svgContent += `<polygon points="${points}" fill="${mark.fillColor}" />`;
        } else {
          svgContent += `<circle cx="${mark.cx}" cy="${mark.cy}" r="${mark.radius}" fill="${mark.fillColor}" />`;
        }
      });
      svgContent += `</svg>`;
      
      const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'stipple_art.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('SVG exported. Your artwork is ready for any size.');
    } catch (error) {
      console.error("Error in downloading SVG:", error);
      showStatus(error.message, 'error');
    }
  }
  
  // Handle image upload and drag-and-drop.
  function handleImageFile(file) {
    if (busyMode) {
      showStatus('Finish generation or stop the animation before replacing your image.', 'error');
      return;
    }
    if (!file.type.startsWith('image/')) {
      showStatus('Choose a supported image file, such as PNG, JPEG, or WebP.', 'error');
      return;
    }
    setBusy('loading');
    showStatus('Loading your image...');
    const reader = new FileReader();
    reader.onerror = () => reportError(new Error('The image could not be read. Try choosing it again.'));
    reader.onload = function(event) {
      const nextImage = new Image();
      nextImage.onerror = () => reportError(new Error('This image could not be decoded. Try a PNG, JPEG, or WebP image.'));
      nextImage.onload = function() {
        image = nextImage;
        viewport.reset();
        stipplePoints = [];
        cellAngles = null;
        globalImgData = null;
        document.getElementById('imageFileName').textContent = file.name;
        document.getElementById('imageFileName').title = file.name;
        document.getElementById('uploadHint').textContent = 'Click to replace your image';
        document.getElementById('previewTitle').textContent = file.name;
        document.getElementById('imageDimensions').textContent = `${image.width.toLocaleString()} x ${image.height.toLocaleString()} px`;
        imageUpload.value = '';
        renderStippleArt();
        setBusy(null);
        showStatus('Image ready. Adjust the details, then generate.');
      };
      nextImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }
  
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
    if (animateVoronoiSwitch.checked) {
      try {
        animateVoronoi(seed);
        showStatus('Your pattern is evolving. Stop when it feels right.');
      } catch (error) {
        reportError(error);
      }
    } else {
      setBusy('static');
      showStatus('Refining your dots...');
      generateStippleArt(seed)
        .then(() => {
          setBusy(null);
          showStatus('Artwork ready. Fine-tune the appearance or export your SVG.');
        })
        .catch(reportError);
    }
  });

  stopButton.addEventListener('click', () => {
    if (animationFrameID) cancelAnimationFrame(animationFrameID);
    animationFrameID = null;
    setBusy(null);
    showStatus('Animation stopped. Your artwork is ready to export.');
  });

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
  
  // Download SVG event.
  downloadSVGButton.addEventListener('click', function() {
    downloadSVG();
  });
});
