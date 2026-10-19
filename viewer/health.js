import fs from "node:fs";
import path from "node:path";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function metric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function listDates(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json") && validDate(name.slice(0, -5)))
    .map((name) => name.slice(0, -5))
    .sort()
    .reverse();
}

function readDay(dir, date) {
  if (!validDate(date)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dir, `${date}.json`), "utf8"));
    return record?.date === date ? record : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function normalizeDay(record) {
  const summary = record.summary || {};
  const sleep = record.sleep?.dailySleepDTO || {};
  const hrv = record.hrv?.hrvSummary || {};
  return {
    date: record.date,
    steps: metric(summary.totalSteps),
    stepGoal: metric(summary.dailyStepGoal),
    restingHeartRate: metric(summary.restingHeartRate ?? record.heartRate?.restingHeartRate),
    averageStress: metric(summary.averageStressLevel ?? record.stressAndBodyBattery?.avgStressLevel),
    bodyBattery: metric(summary.bodyBatteryMostRecentValue),
    bodyBatteryAtWake: metric(summary.bodyBatteryAtWakeTime),
    bodyBatteryHigh: metric(summary.bodyBatteryHighestValue),
    bodyBatteryLow: metric(summary.bodyBatteryLowestValue),
    sleepSeconds: metric(sleep.sleepTimeSeconds),
    sleepScore: metric(sleep.sleepScores?.overall?.value),
    overnightHrv: metric(hrv.lastNightAvg ?? record.sleep?.avgOvernightHrv),
    activeCalories: metric(summary.activeKilocalories),
    moderateIntensityMinutes: metric(summary.moderateIntensityMinutes),
    vigorousIntensityMinutes: metric(summary.vigorousIntensityMinutes),
    averageSpO2: metric(summary.averageSpo2 ?? record.pulseOx?.averageSpO2),
    wakingRespiration: metric(summary.avgWakingRespirationValue ?? record.respiration?.avgWakingRespirationValue),
  };
}

export function registerHealth(app, { dataDir }) {
  const dir = path.join(dataDir, "wellness");

  app.get("/api/health/dates", (_req, res) => {
    try { res.json({ dates: listDates(dir) }); }
    catch (error) { console.error("Health dates:", error); res.status(500).json({ error: "Could not load health dates" }); }
  });

  app.get("/api/health/day/:date", (req, res) => {
    if (!validDate(req.params.date)) return res.status(400).json({ error: "Invalid date" });
    try {
      const record = readDay(dir, req.params.date);
      if (!record) return res.status(404).json({ error: "No health data for this date" });
      res.json(normalizeDay(record));
    } catch (error) {
      console.error("Health day:", error);
      res.status(500).json({ error: "Could not load health data" });
    }
  });

  app.get("/api/health/trends", (req, res) => {
    const days = Number(req.query.days || 7);
    if (![7, 30, 90, 180, 365].includes(days)) return res.status(400).json({ error: "Invalid range" });
    try {
      const dates = listDates(dir);
      const end = req.query.end || dates[0];
      if (!end) return res.json({ days: [] });
      if (!validDate(end)) return res.status(400).json({ error: "Invalid date" });
      const available = new Set(dates);
      const rows = [];
      for (let offset = days - 1; offset >= 0; offset--) {
        const date = addDays(end, -offset);
        const record = available.has(date) ? readDay(dir, date) : null;
        rows.push(record ? normalizeDay(record) : { date });
      }
      res.json({ days: rows });
    } catch (error) {
      console.error("Health trends:", error);
      res.status(500).json({ error: "Could not load health trends" });
    }
  });
}
