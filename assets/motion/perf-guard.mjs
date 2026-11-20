export const QUALITY_LEVELS = Object.freeze(['full', 'lite', 'static']);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createPerfGuard({ windowSize = 90, downshiftMs = 40 } = {}) {
  let index = 0;
  let samples = [];
  return {
    get level() { return QUALITY_LEVELS[index]; },
    sample(frameMs) {
      if (!Number.isFinite(frameMs) || frameMs < 0 || index === QUALITY_LEVELS.length - 1) return QUALITY_LEVELS[index];
      samples.push(frameMs);
      if (samples.length >= windowSize) {
        if (median(samples) > downshiftMs) index += 1;
        samples = [];
      }
      return QUALITY_LEVELS[index];
    }
  };
}
