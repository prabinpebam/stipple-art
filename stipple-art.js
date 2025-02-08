// stipple-art.js
// This script implements a weighted Voronoi stippling algorithm with adjustable parameters,
// optional dot colorization, continuous animation, and drag-and-drop image upload.
// The progress bar is now overlaid in the center of the canvas.
document.addEventListener("DOMContentLoaded", function() {
  const canvas = document.getElementById('stippleCanvas');
  const ctx = canvas.getContext('2d');
  const imageUpload = document.getElementById('imageUpload');
  const randomSeedInput = document.getElementById('randomSeed');
  const generateButton = document.getElementById('generateButton');
  const downloadSVGButton = document.getElementById('downloadSVGButton');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const progressBar = document.getElementById('progressBar');

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
  
  // Resize canvas to fill renderArea.
  function resizeCanvas() {
    const renderArea = document.getElementById('renderArea');
    canvas.width = renderArea.clientWidth;
    canvas.height = renderArea.clientHeight;
    renderStippleArt();
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
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
    progressBar.textContent = percent + '%';
  }
  
  // Get brightness from imageData.
  function getBrightness(x, y, imageData, width) {
    const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
    const r = imageData[idx], g = imageData[idx+1], b = imageData[idx+2];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  
  // Get color from imageData.
  function getColor(x, y, imageData, width) {
    const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
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
  
  // Static generation of stipple art.
  function generateStippleArt(seed) {
    return new Promise((resolve, reject) => {
      try {
        if (!image) throw new Error("No image loaded");
        const rng = mulberry32(seed);
        const desiredCount = parseInt(stippleCountInput.value);
        const iterations = parseInt(iterationCountSlider.value);
        const sampleCount = parseInt(sampleCountSlider.value);
        const whiteCutoff = parseFloat(whiteCutoffSlider.value);
        currentStippleColor = document.querySelector('input[name="colorOption"]:checked').value;
        
        const offCanvas = document.createElement('canvas');
        offCanvas.width = image.width;
        offCanvas.height = image.height;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(image, 0, 0);
        globalImgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height).data;
        
        stipplePoints = [];
        while (stipplePoints.length < desiredCount) {
          const x = rng() * image.width;
          const y = rng() * image.height;
          let brightness = getBrightness(x, y, globalImgData, image.width);
          let weight = (currentStippleColor === 'white') ? (brightness/255) : (1 - brightness/255);
          if (weight > whiteCutoff && rng() < weight) {
            stipplePoints.push({ x, y });
          }
        }
        while (stipplePoints.length < desiredCount) {
          stipplePoints.push({ x: rng() * image.width, y: rng() * image.height });
        }
        
        let currentIteration = 0;
        progressBarContainer.style.display = 'block';
        function iterate() {
          currentIteration++;
          const pointsArr = stipplePoints.map(pt => [pt.x, pt.y]);
          const delaunay = d3.Delaunay.from(pointsArr);
          const voronoi = delaunay.voronoi([0, 0, image.width, image.height]);
          let newPoints = [];
          for (let i = 0; i < stipplePoints.length; i++) {
            const cell = voronoi.cellPolygon(i);
            if (!cell) {
              newPoints.push(stipplePoints[i]);
            } else {
              const [cx, cy] = computeWeightedCentroid(cell, globalImgData, image.width, sampleCount);
              newPoints.push({ x: cx, y: cy });
            }
          }
          stipplePoints = newPoints;
          updateProgress(Math.floor((currentIteration / iterations) * 100));
          if (currentIteration < iterations) {
            requestAnimationFrame(iterate);
          } else {
            updateProgress(100);
            setTimeout(() => {
              progressBarContainer.style.display = 'none';
              resolve();
            }, 500);
          }
        }
        iterate();
      } catch (error) {
        reject(error);
      }
    });
  }
  
  // Animation mode: continuously iterate at ~12 fps.
  function animateVoronoi(seed) {
    if (!image) { alert("Please upload an image first."); return; }
    if (animationFrameID) cancelAnimationFrame(animationFrameID);
    const rng = mulberry32(seed);
    const desiredCount = parseInt(stippleCountInput.value);
    const sampleCount = parseInt(sampleCountSlider.value);
    const whiteCutoff = parseFloat(whiteCutoffSlider.value);
    currentStippleColor = document.querySelector('input[name="colorOption"]:checked').value;
    
    const offCanvas = document.createElement('canvas');
    offCanvas.width = image.width;
    offCanvas.height = image.height;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(image, 0, 0);
    globalImgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height).data;
    
    stipplePoints = [];
    while (stipplePoints.length < desiredCount) {
      const x = rng() * image.width;
      const y = rng() * image.height;
      let brightness = getBrightness(x, y, globalImgData, image.width);
      let weight = (currentStippleColor === 'white') ? (brightness/255) : (1 - brightness/255);
      if (weight > whiteCutoff && rng() < weight) {
        stipplePoints.push({ x, y });
      }
    }
    while (stipplePoints.length < desiredCount) {
      stipplePoints.push({ x: rng() * image.width, y: rng() * image.height });
    }
    
    let lastIterationTime = 0;
    function animateIteration(timestamp) {
      if (!lastIterationTime) lastIterationTime = timestamp;
      if (timestamp - lastIterationTime >= 80) {
        const pointsArr = stipplePoints.map(pt => [pt.x, pt.y]);
        const delaunay = d3.Delaunay.from(pointsArr);
        const voronoi = delaunay.voronoi([0, 0, image.width, image.height]);
        let newPoints = [];
        for (let i = 0; i < stipplePoints.length; i++) {
          const cell = voronoi.cellPolygon(i);
          if (!cell) {
            newPoints.push(stipplePoints[i]);
          } else {
            const [cx, cy] = computeWeightedCentroid(cell, globalImgData, image.width, sampleCount);
            newPoints.push({ x: cx, y: cy });
          }
        }
        stipplePoints = newPoints;
        renderStippleArt();
        lastIterationTime = timestamp;
      }
      animationFrameID = requestAnimationFrame(animateIteration);
    }
    animationFrameID = requestAnimationFrame(animateIteration);
  }
  
  // Render stipple art.
  // If no image is loaded, show instructional text.
  // If image exists but stipple art is not generated, show the preview.
  function renderStippleArt() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) {
      ctx.fillStyle = "#999";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "24px sans-serif";
      ctx.fillText("Upload an image to get started", canvas.width/2, canvas.height/2 - 20);
      ctx.font = "18px sans-serif";
      ctx.fillText("Drag and drop image here to upload", canvas.width/2, canvas.height/2 + 20);
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
    
    ctx.fillStyle = (currentStippleColor === 'white') ? "#333" : "white";
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
          fillColor = (currentStippleColor === 'white') ? 'white' : 'black';
        }
      } else {
        fillColor = (currentStippleColor === 'white') ? 'white' : 'black';
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
      if (!stipplePoints.length || !globalImgData) { alert("No stipple art generated to download."); return; }
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const renderWidth = image.width * scale;
      const renderHeight = image.height * scale;
      const offsetX = (canvas.width - renderWidth) / 2;
      const offsetY = (canvas.height - renderHeight) / 2;
      
      const minSize = parseFloat(minDotSizeSlider.value);
      const sizeRange = parseFloat(dotSizeRangeSlider.value);
      const colorize = colorizeDotsSwitch.checked;
      
      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`;
      svgContent += `<rect width="100%" height="100%" fill="${(currentStippleColor==='white')?'#333':'white'}"/>`;
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
            fillColor = (currentStippleColor === 'white') ? 'white' : 'black';
          }
        } else {
          fillColor = (currentStippleColor === 'white') ? 'white' : 'black';
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
    } catch (error) {
      console.error("Error in downloading SVG:", error);
    }
  }
  
  // Handle image upload and drag-and-drop.
  function handleImageFile(file) {
    stipplePoints = [];
    globalImgData = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const reader = new FileReader();
    reader.onload = function(event) {
      image = new Image();
      image.onload = function() {
        stipplePoints = [];
        renderStippleArt();
      };
      image.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }
  
  imageUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
  });
  
  canvas.addEventListener('dragover', function(e) {
    e.preventDefault();
  });
  canvas.addEventListener('drop', function(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });
  
  // Generate button event.
  generateButton.addEventListener('click', function() {
    const seed = parseInt(randomSeedInput.value) || 42;
    if (!image) { alert("Please upload an image first."); return; }
    if (animateVoronoiSwitch.checked) {
      if (animationFrameID) cancelAnimationFrame(animationFrameID);
      animateVoronoi(seed);
    } else {
      if (animationFrameID) { cancelAnimationFrame(animationFrameID); animationFrameID = null; }
      generateStippleArt(seed)
        .then(() => { renderStippleArt(); })
        .catch(error => { console.error("Generation error:", error); alert("Error: " + error.message); });
    }
  });
  
  // Download SVG event.
  downloadSVGButton.addEventListener('click', function() {
    downloadSVG();
  });
});
