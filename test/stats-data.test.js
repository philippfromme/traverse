import test from "node:test";
import assert from "node:assert/strict";
import { buildBuckets, dateInputValue, inRange, previousRange, selectedRange } from "../viewer/public/components/stats-data.js";

const activity = (time, distance = 1000) => ({ time, distance, duration: 3600 });

test("year comparison uses the same dates in the preceding year", () => {
  const range = selectedRange([], "year", "", "", new Date(2026, 9, 23));
  const previous = previousRange(range, "year");
  assert.equal(dateInputValue(previous.start), "2025-01-01");
  assert.equal(dateInputValue(previous.end), "2025-10-23");
  assert.ok(inRange(activity("2025-10-23T12:00:00"), previous));
  assert.ok(!inRange(activity("2025-10-24T12:00:00"), previous));
});

test("monthly buckets retain empty months and align previous-year values", () => {
  const range = selectedRange([], "year", "", "", new Date(2026, 2, 31));
  const current = [activity("2026-01-15T12:00:00"), activity("2026-03-02T12:00:00", 2000)];
  const previous = [activity("2025-01-20T12:00:00", 3000)];
  const buckets = buildBuckets(range, "month", current, previous, "year");
  assert.deepEqual(buckets.map((b) => b.current.count), [1, 0, 1]);
  assert.deepEqual(buckets.map((b) => b.previous.count), [1, 0, 0]);
  assert.deepEqual(buckets.map((b) => b.current.distance), [1000, 0, 2000]);
});

test("a custom range compares with the immediately preceding equal-length range", () => {
  const range = selectedRange([], "custom", "2026-04-01", "2026-04-30");
  const previous = previousRange(range, "custom");
  assert.equal(dateInputValue(previous.start), "2026-03-02");
  assert.equal(dateInputValue(previous.end), "2026-03-31");
});
