(() => {
  function motionSound(motion, width) {
    const speed = motion.speed || 0;
    return {
      gain: Math.min(3, Math.sqrt(speed / 150) * 2.5),
      frequency: 650 + Math.min(1, speed / 300) * 2500,
      pan: Math.max(-0.85, Math.min(0.85, width ? motion.x / width * 2 - 1 : 0))
    };
  }

  class ParticleAudio {
    constructor() {
      this.enabled = false;
      this.context = null;
      this.generation = 0;
      this.buffer = null;
      this.voices = new Set();
      this.timer = null;
      this.motion = { speed: 0, x: 0 };
      this.lastUpdate = -Infinity;
    }

    async enable() {
      const generation = ++this.generation;
      if (!this.context) {
        if (!globalThis.AudioContext) throw new Error('Particle sound is not supported by this browser.');
        this.context = new AudioContext();
        const context = this.context;
        this.gain = context.createGain();
        this.gain.gain.value = 0;
        this.filter = context.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.Q.value = 0.65;
        this.panner = context.createStereoPanner();
        this.compressor = context.createDynamicsCompressor();
        this.compressor.threshold.value = -6;
        this.compressor.knee.value = 6;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.15;
        this.filter.connect(this.gain).connect(this.panner).connect(this.compressor).connect(context.destination);
      }
      await this.context.resume();
      if (!this.buffer || !this.grains) {
        const response = await fetch('audio/sand-pour.mp3', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Sand recording could not load (${response.status}). Try enabling Sound again.`);
        this.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        this.prepareGrains();
      }
      if (generation !== this.generation) {
        if (!this.enabled) await this.context.suspend();
        return;
      }
      if (this.context.state !== 'running') throw new Error('The browser blocked particle sound. Toggle Sound again to enable it.');
      this.enabled = true;
      if (this.timer === null) this.timer = setInterval(() => this.scheduleGrains(), 40);
    }

    disable() {
      this.generation++;
      this.enabled = false;
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      this.silence();
      if (this.context) return this.context.suspend();
      return Promise.resolve();
    }

    silence() {
      this.motion = { speed: 0, x: 0 };
      this.lastUpdate = -Infinity;
      if (!this.context) return;
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(0, this.context.currentTime);
      for (const voice of this.voices) voice.stop();
      this.voices.clear();
    }

    update(motion, width) {
      if (!this.enabled || this.context.state !== 'running') return;
      const values = motionSound(motion, width), time = this.context.currentTime;
      this.motion = { ...motion };
      this.lastUpdate = time;
      if (motion.speed > 0.05 && this.timer === null) {
        this.scheduleGrains();
        this.timer = setInterval(() => this.scheduleGrains(), 40);
      }
      this.gain.gain.setTargetAtTime(values.gain, time, 0.06);
      this.filter.frequency.setTargetAtTime(values.frequency, time, 0.1);
      this.panner.pan.setTargetAtTime(values.pan, time, 0.08);
    }

    prepareGrains() {
      const channel = this.buffer.getChannelData(0);
      const length = Math.floor(this.buffer.sampleRate * 0.32);
      const candidates = [];
      let strongest = 0;
      for (let start = 0; start + length <= channel.length; start += length) {
        let energy = 0;
        for (let i = start; i < start + length; i += 16) energy += channel[i] * channel[i];
        const rms = Math.sqrt(energy / Math.ceil(length / 16));
        strongest = Math.max(strongest, rms);
        candidates.push({ offset: start / this.buffer.sampleRate, rms });
      }
      this.grains = candidates.filter(grain => grain.rms >= Math.max(0.0001, strongest * 0.25));
      if (!this.grains.length) throw new Error('The sand recording contains no usable audio.');
      this.window = Float32Array.from({ length: 64 }, (_, i) => Math.sin(Math.PI * i / 63) ** 2 * 0.5);
      this.nextGrain = 0;
    }

    scheduleGrains() {
      const context = this.context;
      if (!this.enabled || context.state !== 'running' || !this.buffer) return;
      const now = context.currentTime;
      if (now - this.lastUpdate > 0.25 || this.motion.speed < 0.05) {
        this.gain.gain.setTargetAtTime(0, now, 0.06);
        this.nextGrain = now;
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        return;
      }
      this.nextGrain = Math.max(now, this.nextGrain);
      const rate = 0.85 + Math.min(1, this.motion.speed / 300) * 0.4;
      while (this.nextGrain < now + 0.12) {
        const source = context.createBufferSource(), envelope = context.createGain();
        source.buffer = this.buffer;
        source.playbackRate.value = rate;
        const grain = this.grains[Math.floor(Math.random() * this.grains.length)];
        const duration = 0.3 / rate;
        envelope.gain.setValueCurveAtTime(this.window, this.nextGrain, duration);
        source.connect(envelope).connect(this.filter);
        this.voices.add(source);
        source.onended = () => {
          this.voices.delete(source);
          source.disconnect();
          envelope.disconnect();
        };
        source.start(this.nextGrain, grain.offset, 0.3);
        this.nextGrain += duration / 3;
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { motionSound, ParticleAudio };
  else globalThis.ParticleAudio = ParticleAudio;
})();
