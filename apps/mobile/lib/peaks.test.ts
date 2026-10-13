import { test } from "node:test";
import assert from "node:assert/strict";
import { downsamplePeaks } from "./peaks.ts";

test("empty input returns empty output", () => {
  assert.deepEqual(downsamplePeaks([], 10), []);
});

test("barCount of zero returns empty output", () => {
  assert.deepEqual(downsamplePeaks([[-1, 1], [-1, 1]], 0), []);
});

test("one bucket per source point when barCount equals length", () => {
  const input: [number, number][] = [[-1, 1], [-2, 2], [-3, 3]];
  assert.deepEqual(downsamplePeaks(input, 3), input);
});

test("aggregates min and max within each bucket", () => {
  const input: [number, number][] = [
    [-1, 1],
    [-5, 0.5],
    [-0.5, 5],
    [-2, 2],
  ];
  const result = downsamplePeaks(input, 2);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], [-5, 1]);
  assert.deepEqual(result[1], [-2, 5]);
});

test("barCount larger than input length still returns barCount entries", () => {
  const input: [number, number][] = [[-1, 1]];
  const result = downsamplePeaks(input, 5);
  assert.equal(result.length, 5);
});
