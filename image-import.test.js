const test = require('node:test');
const assert = require('node:assert/strict');
const { prepare, workingSize, inspectHeader, fileType, validateFile, validateDimensions, MAX_FILE_BYTES } = require('./image-import.js');

test('high-resolution images are bounded with their aspect ratio retained', () => {
  assert.deepEqual(workingSize(12000, 8000, 2048), { width: 2048, height: 1365 });
  assert.deepEqual(workingSize(8000, 12000, 4096), { width: 2731, height: 4096 });
  assert.deepEqual(workingSize(10000, 1, 1024), { width: 1024, height: 1 });
});

test('small images are never upscaled at any working resolution', () => {
  for (const edge of [1024, 2048, 4096]) {
    assert.deepEqual(workingSize(640, 480, edge), { width: 640, height: 480 });
  }
});

test('pixel buffers remain within the selected square budget', () => {
  for (const edge of [1024, 2048, 4096]) {
    const size = workingSize(10000, 10000, edge);
    assert.ok(size.width * size.height * 4 <= edge * edge * 4);
  }
});

test('invalid and extreme dimensions report errors', () => {
  for (const dimensions of [[0, 1], [1, -1], [NaN, 1], [1.1, 2], [10001, 10000], [65536, 1]]) {
    assert.throws(() => validateDimensions(...dimensions), /dimensions|safety limit/);
  }
  assert.throws(() => workingSize(100, 100, 999), /resolution/);
});

test('upload byte limits are checked before decoding', () => {
  assert.throws(() => validateFile({ size: 0 }), /empty/);
  assert.throws(() => validateFile({ size: MAX_FILE_BYTES + 1 }), /100 MiB/);
  assert.doesNotThrow(() => validateFile({ size: MAX_FILE_BYTES }));
});

test('PNG signature provides dimensions independent of filename and MIME', () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 10000);
  view.setUint32(20, 8000);
  const header = inspectHeader(bytes.buffer);
  assert.deepEqual(header, { type: 'image/png', width: 10000, height: 8000 });
  assert.equal(fileType({ name: 'file.bin', type: 'application/octet-stream' }, header), 'image/png');
});

test('GIF dimensions and top-down BMP dimensions are recognized', () => {
  const gif = new Uint8Array(10);
  gif.set(Buffer.from('GIF89a'));
  new DataView(gif.buffer).setUint16(6, 320, true);
  new DataView(gif.buffer).setUint16(8, 200, true);
  assert.deepEqual(inspectHeader(gif.buffer), { type: 'image/gif', width: 320, height: 200 });
  const bmp = new Uint8Array(26);
  bmp.set(Buffer.from('BM'));
  const view = new DataView(bmp.buffer);
  view.setUint32(14, 40, true);
  view.setInt32(18, 640, true);
  view.setInt32(22, -480, true);
  assert.deepEqual(inspectHeader(bmp.buffer), { type: 'image/bmp', width: 640, height: 480 });
});

test('WebP extended header provides dimensions', () => {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBPVP8X'), 8);
  bytes[24] = 255;
  bytes[25] = 3;
  bytes[27] = 255;
  bytes[28] = 1;
  assert.deepEqual(inspectHeader(bytes.buffer), { type: 'image/webp', width: 1024, height: 512 });
});

function jpeg(orientation) {
  const bytes = new Uint8Array(50);
  bytes.set([255, 216, 255, 225, 0, 34]);
  bytes.set(Buffer.from('Exif\0\0II'), 6);
  const view = new DataView(bytes.buffer);
  view.setUint16(14, 42, true);
  view.setUint32(16, 8, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 274, true);
  view.setUint16(24, 3, true);
  view.setUint32(26, 1, true);
  view.setUint16(30, orientation, true);
  bytes.set([255, 192, 0, 8, 8, 0, 100, 0, 200, 3, 255, 217], 38);
  return bytes.buffer;
}

test('JPEG dimensions account for EXIF orientations that swap axes', () => {
  assert.deepEqual(inspectHeader(jpeg(1)), { type: 'image/jpeg', width: 200, height: 100 });
  for (const orientation of [5, 6, 7, 8]) {
    assert.deepEqual(inspectHeader(jpeg(orientation)), { type: 'image/jpeg', width: 100, height: 200 });
  }
});

test('truncated and malformed headers never read outside the buffer', () => {
  for (let length = 0; length < 50; length++) {
    assert.doesNotThrow(() => inspectHeader(jpeg(6).slice(0, length)));
  }
  const malformed = new Uint8Array(jpeg(6));
  new DataView(malformed.buffer).setUint32(16, 0xffffffff, true);
  assert.doesNotThrow(() => inspectHeader(malformed.buffer));
});

test('AVIF compatibility brands, SVG and TIFF signatures are recognized', () => {
  const avif = new Uint8Array(24);
  const view = new DataView(avif.buffer);
  view.setUint32(0, 24);
  avif.set(Buffer.from('ftypmif1'), 4);
  avif.set(Buffer.from('avif'), 16);
  assert.equal(inspectHeader(avif.buffer).type, 'image/avif');
  assert.equal(inspectHeader(Uint8Array.from(Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 10 10"/>')).buffer).type, 'image/svg+xml');
  assert.equal(inspectHeader(Uint8Array.from([73, 73, 42, 0]).buffer).type, 'image/tiff');
});

test('extensions accept missing MIME types without accepting arbitrary files', () => {
  for (const [name, type] of [['photo.JPEG', 'image/jpeg'], ['art.svg', 'image/svg+xml'], ['phone.heic', 'image/heic'], ['scan.TIFF', 'image/tiff']]) {
    assert.equal(fileType({ name, type: '' }, {}), type);
  }
  assert.equal(fileType({ name: 'picture.unknown', type: 'image/unknown' }, {}), 'image/unknown');
  assert.equal(fileType({ name: 'not-image.txt', type: 'text/plain' }, {}), null);
});

test('timed-out bitmap requests report an error and release late results', async t => {
  let complete, closed = 0;
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = () => new Promise(resolve => { complete = resolve; });
  t.after(() => {
    if (original === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original;
  });

  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  blob.name = 'timeout.png';
  await assert.rejects(prepare(blob, 2048, '#ffffff'), /decoding timed out/);
  complete({ close() { closed++; } });
  await Promise.resolve();
  assert.equal(closed, 1);
});

test('import preserves alpha without assigning a background color', async t => {
  const originalDocument = globalThis.document;
  const originalBitmap = globalThis.createImageBitmap;
  const pixels = new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 0, 0]);
  let closed = false;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1, close() { closed = true; } });
  globalThis.document = {
    createElement() {
      return { getContext() {
        return {
          fillRect() { assert.fail('Transparent source must not be flattened'); },
          drawImage() {},
          getImageData() { return { data: pixels }; }
        };
      } };
    }
  };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalBitmap;
  });
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 2);
  view.setUint32(20, 1);
  const blob = new Blob([bytes], { type: 'image/png' });
  blob.name = 'alpha.png';
  const result = await prepare(blob, 2048);
  assert.equal(result.pixels, pixels);
  assert.equal(result.hasTransparency, true);
  assert.equal(result.pixels[3], 128);
  assert.equal(result.pixels[7], 0);
  assert.equal(closed, true);
});
