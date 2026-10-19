import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import { registerHealth } from "./health.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "traverse-health-"));
const wellnessDir = path.join(dataDir, "wellness");
fs.mkdirSync(wellnessDir);
fs.writeFileSync(path.join(wellnessDir, "2026-10-17.json"), JSON.stringify({
  date: "2026-10-17",
  summary: { totalSteps: 0, dailyStepGoal: 5000, restingHeartRate: 52, averageStressLevel: -1, bodyBatteryMostRecentValue: 60 },
  sleep: { dailySleepDTO: { sleepTimeSeconds: null } },
  privateToken: "never expose",
}));
fs.writeFileSync(path.join(wellnessDir, "2026-10-19.json"), JSON.stringify({
  date: "2026-10-19",
  summary: { totalSteps: 8200, dailyStepGoal: 5000, bodyBatteryMostRecentValue: 38 },
}));

const app = express();
registerHealth(app, { dataDir });
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("lists available dates newest first", async () => {
  const response = await fetch(`${base}/api/health/dates`);
  assert.deepEqual(await response.json(), { dates: ["2026-10-19", "2026-10-17"] });
});

test("normalizes day, preserves recorded zero, hides raw Garmin fields", async () => {
  const response = await fetch(`${base}/api/health/day/2026-10-17`);
  const day = await response.json();
  assert.equal(day.steps, 0);
  assert.equal(day.averageStress, null);
  assert.equal(day.sleepSeconds, null);
  assert.equal(day.restingHeartRate, 52);
  assert.equal(JSON.stringify(day).includes("never expose"), false);
});

test("trend keeps calendar gaps distinct from zero", async () => {
  const response = await fetch(`${base}/api/health/trends?days=7&end=2026-10-19`);
  const { days } = await response.json();
  assert.equal(days.length, 7);
  assert.equal(days[4].date, "2026-10-17");
  assert.equal(days[4].steps, 0);
  assert.deepEqual(days[5], { date: "2026-10-18" });
  assert.equal(days[6].steps, 8200);
});

test("supports longer ranges through one year", async () => {
  for (const range of [90, 180, 365]) {
    const response = await fetch(`${base}/api/health/trends?days=${range}&end=2026-10-19`);
    assert.equal(response.status, 200);
    const { days } = await response.json();
    assert.equal(days.length, range);
    assert.equal(days.at(-1).steps, 8200);
    assert.deepEqual(days.at(-2), { date: "2026-10-18" });
  }
});

test("rejects invalid dates and unsupported ranges", async () => {
  assert.equal((await fetch(`${base}/api/health/day/2026-02-30`)).status, 400);
  assert.equal((await fetch(`${base}/api/health/day/2026-10-18`)).status, 404);
  assert.equal((await fetch(`${base}/api/health/trends?days=366`)).status, 400);
});
