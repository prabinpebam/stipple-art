(() => {
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_SOURCE_PIXELS = 100000000;
  const MAX_SOURCE_EDGE = 65535;
  const HEADER_BYTES = 256 * 1024;
  const MIME_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
    png: 'image/png', apng: 'image/png', webp: 'image/webp', avif: 'image/avif',
    gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
    tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl'
  };

  function workingSize(width, height, edge) {
    if (![1024, 2048, 4096].includes(edge)) throw new Error('Choose a supported working resolution.');
    validateDimensions(width, height);
    const scale = Math.min(1, edge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function validateDimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new Error('The image has invalid dimensions.');
    }
    if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
      throw new Error('This image exceeds the 100 megapixel or 65,535 px edge safety limit. Resize it before importing.');
    }
  }

  function inspectHeader(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    const ascii = (offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count));
    if (bytes.length >= 24 && ascii(1, 3) === 'PNG' && bytes[0] === 137) {
      return { type: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) {
      return { type: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (bytes.length >= 26 && ascii(0, 2) === 'BM') {
      if (view.getUint32(14, true) === 12) {
        return { type: 'image/bmp', width: view.getUint16(18, true), height: view.getUint16(20, true) };
      }
      return { type: 'image/bmp', width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    }
    if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const kind = ascii(12, 4);
      if (kind === 'VP8X') {
        const uint24 = offset => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
        return { type: 'image/webp', width: uint24(24) + 1, height: uint24(27) + 1 };
      }
      if (kind === 'VP8 ' && bytes.length >= 30) {
        return { type: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (kind === 'VP8L' && bytes[20] === 47) {
        const bits = view.getUint32(21, true);
        return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      return { type: 'image/webp' };
    }
    if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2, dimensions = null, orientation = 1;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 255) break;
        const marker = bytes[offset + 1];
        if (marker === 255) { offset++; continue; }
        if (marker === 218 || marker === 217) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) { offset += 2; continue; }
        const length = view.getUint16(offset + 2);
        const end = offset + 2 + length;
        if (length < 2 || end > bytes.length) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
          dimensions = { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
        }
        if (marker === 225 && length >= 16 && ascii(offset + 4, 6) === 'Exif\0\0') {
          const base = offset + 10;
          const little = ascii(base, 2) === 'II';
          if ((little || ascii(base, 2) === 'MM') && view.getUint16(base + 2, little) === 42) {
            const directory = base + view.getUint32(base + 4, little);
            if (directory >= base && directory + 2 <= end) {
              const count = view.getUint16(directory, little);
              for (let i = 0; i < count; i++) {
                const entry = directory + 2 + i * 12;
                if (entry + 12 > end) break;
                if (view.getUint16(entry, little) === 274 && view.getUint16(entry + 2, little) === 3 &&
                    view.getUint32(entry + 4, little) === 1) {
                  orientation = view.getUint16(entry + 8, little);
                }
              }
            }
          }
        }
        offset = end;
      }
      if (dimensions && orientation >= 5 && orientation <= 8) {
        dimensions = { width: dimensions.height, height: dimensions.width };
      }
      return { type: 'image/jpeg', ...dimensions };
    }
    if (bytes.length >= 6 && view.getUint16(0, true) === 0 && view.getUint16(2, true) === 1) {
      return { type: 'image/x-icon' };
    }
    if (bytes.length >= 12 && ascii(4, 4) === 'ftyp') {
      const brand = ascii(8, 4);
      const brands = [brand];
      const end = Math.min(bytes.length, view.getUint32(0), 256);
      for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(offset, 4));
      if (brands.some(value => ['avif', 'avis'].includes(value))) return { type: 'image/avif' };
      if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return { type: 'image/heic' };
      if (['mif1', 'msf1'].includes(brand)) return { type: 'image/heif' };
    }
    if (bytes.length >= 4 && ['II*\0', 'MM\0*'].includes(ascii(0, 4))) return { type: 'image/tiff' };
    const text = new TextDecoder().decode(bytes.subarray(0, 4096));
    if (/<svg[\s>]/i.test(text)) return { type: 'image/svg+xml' };
    return {};
  }

  function fileType(file, header) {
    if (header.type) return header.type;
    if (file.type.startsWith('image/')) return file.type;
    const extension = file.name.split('.').pop().toLowerCase();
    return Object.hasOwn(MIME_TYPES, extension) ? MIME_TYPES[extension] : null;
  }

  function validateFile(file) {
    if (!file.size) throw new Error('This file is empty. Choose an image containing data.');
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('This file exceeds the 100 MiB upload limit. Compress or resize it before importing.');
    }
  }

  function decodeError(type, cause) {
    const advice = ['image/heic', 'image/heif', 'image/tiff', 'image/jxl'].includes(type) ?
      'HEIC/HEIF, TIFF, and JPEG XL require browser decoder support. Convert to PNG, JPEG, or WebP if unavailable.' :
      'The file may be damaged or its format unsupported. Try exporting it as PNG, JPEG, or WebP.';
    return new Error(`This image could not be decoded by your browser. ${advice}`, { cause });
  }

  async function decodeBitmap(blob, options) {
    let expired = false, timer;
    try {
      const decode = createImageBitmap(blob, options).then(bitmap => {
        if (expired) bitmap.close();
        return bitmap;
      });
      return await Promise.race([
        decode,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            const error = new Error('Image decoding timed out. Try a smaller image or another format.');
            error.name = 'TimeoutError';
            reject(error);
          }, 60000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function decodeWithImage(blob, type) {
    const url = URL.createObjectURL(blob);
    const source = new Image();
    let timer;
    try {
      await new Promise((resolve, reject) => {
        source.onload = resolve;
        source.onerror = () => reject(new Error('The browser could not decode this image.'));
        timer = setTimeout(() => reject(new Error('Image decoding timed out. Try a smaller image or another format.')), 60000);
        source.src = url;
      });
      return source;
    } catch (error) {
      source.src = '';
      throw decodeError(type, error);
    } finally {
      clearTimeout(timer);
      source.onload = null;
      source.onerror = null;
      URL.revokeObjectURL(url);
    }
  }

  async function prepare(file, edge) {
    validateFile(file);
    const header = inspectHeader(await file.slice(0, HEADER_BYTES).arrayBuffer());
    const type = fileType(file, header);
    if (!type) throw new Error('Choose an image file. Its type or extension must identify a supported image format.');
    const known = header.width !== undefined && header.height !== undefined;
    if (known) validateDimensions(header.width, header.height);
    const blob = file.slice(0, file.size, type);
    const target = known ? workingSize(header.width, header.height, edge) : null;
    let source;
    if (typeof createImageBitmap === 'function' && type !== 'image/svg+xml') {
      try {
        source = await decodeBitmap(blob, target ? {
          resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high',
          imageOrientation: 'from-image'
        } : { imageOrientation: 'from-image' });
      } catch (error) {
        if (error.name === 'TimeoutError') throw error;
        console.warn('Bitmap decoding unavailable for this image; trying the browser image element.', error);
        source = await decodeWithImage(blob, type);
      }
    } else {
      source = await decodeWithImage(blob, type);
    }
    try {
      const sourceWidth = source.naturalWidth || source.width;
      const sourceHeight = source.naturalHeight || source.height;
      const originalWidth = known ? header.width : sourceWidth;
      const originalHeight = known ? header.height : sourceHeight;
      const size = workingSize(originalWidth, originalHeight, edge);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Your browser could not allocate an image-processing canvas. Choose Fast resolution.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hasTransparency = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 255) { hasTransparency = true; break; }
      }
      return { canvas, pixels, hasTransparency, originalWidth, originalHeight, type, bytes: file.size };
    } finally {
      if (typeof source.close === 'function') source.close();
      else source.src = '';
    }
  }

  const importer = { prepare, workingSize, inspectHeader, fileType, validateFile, validateDimensions, MAX_FILE_BYTES, MAX_SOURCE_PIXELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = importer;
  else globalThis.ImageImport = importer;
})();
