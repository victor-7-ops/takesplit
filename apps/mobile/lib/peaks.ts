export function downsamplePeaks(
  peaks: [number, number][],
  barCount: number
): [number, number][] {
  if (peaks.length === 0 || barCount <= 0) {
    return [];
  }

  const bucketSize = peaks.length / barCount;
  const result: [number, number][] = [];

  for (let i = 0; i < barCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let min = Infinity;
    let max = -Infinity;
    for (let j = start; j < end && j < peaks.length; j++) {
      min = Math.min(min, peaks[j][0]);
      max = Math.max(max, peaks[j][1]);
    }
    if (min === Infinity) {
      const fallback = peaks[Math.min(start, peaks.length - 1)];
      result.push([fallback[0], fallback[1]]);
    } else {
      result.push([min, max]);
    }
  }

  return result;
}
