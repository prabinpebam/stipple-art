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

  // Default: White on Black.
  let currentStippleColor = 'white';
  let image = null;
  let stipplePoints = []; // Array of { x, y } in image coordinate space.
  let globalImgData = null; // Full-resolution image pixel data.
  let animationFrameID = null;
  let busyMode = null;

  function showStatus(message, tone = 'normal') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setBusy(mode) {
    busyMode = mode;
    settingsForm.querySelectorAll('input').forEach(input => { input.disabled = Boolean(mode); });
    generateButton.disabled = Boolean(mode) || !image;
    downloadSVGButton.disabled = mode === 'loading' || mode === 'static' || !stipplePoints.length;
    stopButton.hidden = mode !== 'animation';
    stage.classList.toggle('is-busy', Boolean(mode));
    stage.setAttribute('aria-busy', String(Boolean(mode)));
    document.getElementById('previewState').textContent = mode === 'loading' ? 'Loading image' :
      mode === 'static' ? 'Refining dots' : mode === 'animation' ? 'Animating' :
      stipplePoints.length ? `${stipplePoints.length.toLocaleString()} dots` : image ? 'Image ready' : 'No image yet';
  }

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
        points.push({ x, y });
      }
    }
    if (points.length < desiredCount) {
      stipplePoints = [];
      throw new Error('Not enough image contrast to place the dots. Lower the brightness cutoff or switch ink & paper.');
    }
    stipplePoints = points;
  }

  function refinePoints(sampleCount) {
    const delaunay = d3.Delaunay.from(stipplePoints.map(pt => [pt.x, pt.y]));
    const voronoi = delaunay.voronoi([0, 0, image.width, image.height]);
    stipplePoints = stipplePoints.map((pt, i) => {
      const cell = voronoi.cellPolygon(i);
      if (!cell) return pt;
      const [x, y] = computeWeightedCentroid(cell, globalImgData, image.width, sampleCount);
      return { x, y };
    });
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
  
  // Render stipple art.
  // If image exists but stipple art is not generated, show the preview.
  function renderStippleArt() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('emptyState').hidden = Boolean(image);
    if (!image) {
      return;
    }
    if (stipplePoints.length === 0) {
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const renderWidth = image.width * scale;
      const renderHeight = image.height * scale;
      const offsetX = (canvas.width - renderWidth) / 2;
      const offsetY = (canvas.height - renderHeight) / 2;
      ctx.drawImage(image, offsetX, offsetY, renderWidth, renderHeight);
      return;
    }
    
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const renderWidth = image.width * scale;
    const renderHeight = image.height * scale;
    const offsetX = (canvas.width - renderWidth) / 2;
    const offsetY = (canvas.height - renderHeight) / 2;
    
    ctx.fillStyle = currentStippleColor === 'white' ? paperDark : paperLight;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const minSize = parseFloat(minDotSizeSlider.value);
    const sizeRange = parseFloat(dotSizeRangeSlider.value);
    const colorize = colorizeDotsSwitch.checked;
    
    stipplePoints.forEach(pt => {
      let brightness = getBrightness(pt.x, pt.y, globalImgData, image.width);
      const norm = (currentStippleColor === 'white') ? (brightness/255) : (1 - brightness/255);
      const dotRadius = minSize + norm * sizeRange;
      const cx = offsetX + pt.x * scale;
      const cy = offsetY + pt.y * scale;
      let fillColor;
      if (colorize) {
        const imageDotRadius = dotRadius / scale;
        const samples = 10;
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let i = 0; i < samples; i++) {
          const angle = Math.random() * 2 * Math.PI;
          const r = Math.random() * imageDotRadius;
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
        if (count > 0) {
          const avgR = Math.round(sumR / count);
          const avgG = Math.round(sumG / count);
          const avgB = Math.round(sumB / count);
          fillColor = `rgb(${avgR}, ${avgG}, ${avgB})`;
        } else {
          fillColor = currentStippleColor === 'white' ? inkLight : inkDark;
        }
      } else {
        fillColor = currentStippleColor === 'white' ? inkLight : inkDark;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius, 0, 2*Math.PI);
      ctx.fillStyle = fillColor;
      ctx.fill();
    });
  }
  
  // Download as SVG.
  function downloadSVG() {
    try {
      if (!stipplePoints.length || !globalImgData) {
        throw new Error('Generate stipple art before exporting.');
      }
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const renderWidth = image.width * scale;
      const renderHeight = image.height * scale;
      const offsetX = (canvas.width - renderWidth) / 2;
      const offsetY = (canvas.height - renderHeight) / 2;
      
      const minSize = parseFloat(minDotSizeSlider.value);
      const sizeRange = parseFloat(dotSizeRangeSlider.value);
      const colorize = colorizeDotsSwitch.checked;
      
      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`;
      svgContent += `<rect width="100%" height="100%" fill="${currentStippleColor === 'white' ? paperDark : paperLight}"/>`;
      stipplePoints.forEach(pt => {
        let brightness = getBrightness(pt.x, pt.y, globalImgData, image.width);
        const norm = (currentStippleColor === 'white') ? (brightness/255) : (1 - brightness/255);
        const dotRadius = minSize + norm * sizeRange;
        const cx = offsetX + pt.x * scale;
        const cy = offsetY + pt.y * scale;
        let fillColor;
        if (colorize) {
          const imageDotRadius = dotRadius / scale;
          const samples = 10;
          let sumR = 0, sumG = 0, sumB = 0, count = 0;
          for (let i = 0; i < samples; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const r = Math.random() * imageDotRadius;
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
          if (count > 0) {
            const avgR = Math.round(sumR / count);
            const avgG = Math.round(sumG / count);
            const avgB = Math.round(sumB / count);
            fillColor = `rgb(${avgR}, ${avgG}, ${avgB})`;
          } else {
            fillColor = currentStippleColor === 'white' ? inkLight : inkDark;
          }
        } else {
          fillColor = currentStippleColor === 'white' ? inkLight : inkDark;
        }
        svgContent += `<circle cx="${cx}" cy="${cy}" r="${dotRadius}" fill="${fillColor}" />`;
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
        stipplePoints = [];
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

  [minDotSizeSlider, dotSizeRangeSlider, colorizeDotsSwitch].forEach(input => {
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
