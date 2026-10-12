const test = require('node:test');
const assert = require('node:assert/strict');
const { phoneProfile, backingRatio, yieldToInput } = require('./mobile-runtime.js');

test('phone defaults apply to small screens or narrow touch devices, not desktop', () => {
  assert.equal(phoneProfile(390, true), true);
  assert.equal(phoneProfile(844, true), true);
  assert.equal(phoneProfile(844, false), false);
  assert.equal(phoneProfile(1440, false), false);
});

test('backing canvas respects phone density and the four-megapixel budget', () => {
  assert.equal(backingRatio(390, 600, 3, true), 2);
  assert.equal(backingRatio(800, 600, 2, false), 2);
  const ratio = backingRatio(2000, 1500, 3, false);
  assert.ok(2000 * ratio * 1500 * ratio <= 4000000.01);
});

test('generation yields to input before proceeding', async () => {
  let inputHandled = false;
  const input = new Promise(resolve => setTimeout(() => { inputHandled = true; resolve(); }, 0));
  await yieldToInput({ cancelled: false });
  assert.equal(inputHandled, true);
  await input;
});

test('cancellation is reported explicitly before publishing new work', async () => {
  await assert.rejects(yieldToInput({ cancelled: true }), { name: 'AbortError', message: 'Generation cancelled.' });
});
