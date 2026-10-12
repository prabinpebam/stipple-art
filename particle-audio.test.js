const test = require('node:test');
const assert = require('node:assert/strict');
const { motionSound, ParticleAudio } = require('./particle-audio.js');
const { ParticleField } = require('./particle-field.js');

test('settled particles produce silence and faster particles sound stronger and brighter', () => {
  assert.equal(motionSound({ speed: 0, x: 100 }, 800).gain, 0);
  const slow = motionSound({ speed: 10, x: 100 }, 800);
  const fast = motionSound({ speed: 200, x: 100 }, 800);
  assert.ok(fast.gain > slow.gain);
  assert.ok(fast.frequency > slow.frequency);
  assert.ok(motionSound({ speed: 10000, x: 0 }, 800).gain <= 3);
});

test('stereo placement follows moving particles and stays bounded', () => {
  assert.ok(motionSound({ speed: 50, x: 100 }, 800).pan < 0);
  assert.ok(motionSound({ speed: 50, x: 700 }, 800).pan > 0);
  assert.equal(motionSound({ speed: 50, x: 400 }, 800).pan, 0);
  assert.equal(motionSound({ speed: 50, x: 10000 }, 800).pan, 0.85);
});

test('sound is off by default', () => {
  const audio = new ParticleAudio();
  assert.equal(audio.enabled, false);
  assert.equal(audio.context, null);
  assert.doesNotThrow(() => audio.update({ speed: 100, x: 200 }, 800));
});

test('motion continues to drive sound after cursor leaves, then settles to silence', () => {
  const particles = new ParticleField();
  particles.reset(Array.from({ length: 100 }, (_, i) => ({ cx: 100 + i % 10, cy: 100 + Math.floor(i / 10) })));
  particles.setEnabled(true);
  particles.move(90, 100, 0);
  const view = { zoom: 1, x: 0, y: 0, width: 800, height: 600 };
  for (let i = 0; i < 20; i++) particles.advance(i * 1000 / 60, view);
  assert.ok(particles.motion.speed > 0);
  particles.leave();
  particles.advance(21 * 1000 / 60, view);
  assert.ok(particles.motion.speed > 0);
  for (let i = 22; i < 1200; i++) particles.advance(i * 1000 / 60, view);
  assert.equal(particles.motion.speed, 0);
  assert.equal(motionSound(particles.motion, 800).gain, 0);
});

test('real sample grains use overlapping envelopes and speed-dependent playback', () => {
  const audio = new ParticleAudio();
  const scheduled = [];
  const context = {
    currentTime: 0, state: 'running',
    createBufferSource() {
      return {
        playbackRate: {}, connect() { return this; }, disconnect() {},
        start(time, offset, duration) { scheduled.push({ time, offset, duration, rate: this.playbackRate.value }); },
        stop() {}
      };
    },
    createGain() {
      return {
        gain: { setValueCurveAtTime(curve, time, duration) {
          assert.equal(curve[0], 0);
          assert.ok(curve.at(-1) < 1e-10);
          assert.ok(duration > 0);
        } },
        connect() { return this; }, disconnect() {}
      };
    }
  };
  audio.context = context;
  audio.buffer = {};
  audio.grains = [{ offset: 2 }, { offset: 4 }];
  audio.window = Float32Array.from([0, 0.5, 0]);
  audio.nextGrain = 0;
  audio.lastUpdate = 0;
  audio.motion = { speed: 200, x: 200 };
  audio.enabled = true;
  audio.scheduleGrains();
  assert.ok(scheduled.length >= 2);
  assert.ok(scheduled[0].rate > 1);
  assert.ok(scheduled[1].time < scheduled[0].duration / scheduled[0].rate);
  assert.ok(scheduled.every(grain => [2, 4].includes(grain.offset)));
});

test('idle audio stops waking the scheduler until new motion arrives', t => {
  const cleared = [];
  t.mock.method(globalThis, 'clearInterval', id => cleared.push(id));
  const audio = new ParticleAudio();
  audio.enabled = true;
  audio.buffer = {};
  audio.timer = 123;
  audio.lastUpdate = 0;
  audio.context = { currentTime: 1, state: 'running' };
  audio.gain = { gain: { setTargetAtTime() {} } };
  audio.scheduleGrains();
  assert.equal(audio.timer, null);
  assert.deepEqual(cleared, [123]);
});
