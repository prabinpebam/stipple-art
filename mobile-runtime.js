(() => {
  function phoneProfile(width, coarse) {
    return width <= 600 || (coarse && width < 1024);
  }

  function backingRatio(width, height, density, phone) {
    return Math.min(density, phone ? 2 : density, Math.sqrt(4000000 / Math.max(1, width * height)));
  }

  function yieldToInput(job) {
    const pause = globalThis.scheduler && typeof globalThis.scheduler.yield === 'function' ?
      globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
    return pause.then(() => {
      if (job && job.cancelled) {
        const error = new Error('Generation cancelled.');
        error.name = 'AbortError';
        throw error;
      }
    });
  }

  const runtime = { phoneProfile, backingRatio, yieldToInput };
  if (typeof module !== 'undefined' && module.exports) module.exports = runtime;
  else globalThis.StudioRuntime = runtime;
})();
