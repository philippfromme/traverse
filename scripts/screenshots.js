import { chromium } from "playwright";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;
const DOCS_DIR = path.resolve("docs");

// find a recent activity with GPS track
const activities = JSON.parse(fs.readFileSync("data/activity-index.json", "utf-8"));
const activityWithTrack = activities
  .filter((a) => a.hasTrack && a.distance > 1000)
  .sort((a, b) => new Date(b.time) - new Date(a.time))[0];

const types = [...new Set(activities.map((a) => a.type))];
const statsType =
  types.find((t) => {
    const count = activities.filter((a) => a.type === t && a.hasTrack).length;
    return count >= 5;
  }) || types[0];

if (!activityWithTrack) {
  console.error("No activity with GPS track found");
  process.exit(1);
}

async function waitForServer(url, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not start in time");
}

async function run() {
  // start server
  const server = spawn("node", ["viewer/server.js"], {
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "production" },
  });

  server.stderr.on("data", (d) => process.stderr.write(d));

  try {
    await waitForServer(`${BASE}/api/activities`);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    const pages = [
      { name: "activities", url: "/" },
      { name: "activity", url: `/activity/${activityWithTrack.id}` },
      { name: "stats", url: "/stats" },
      { name: "stat", url: `/stats/${encodeURIComponent(statsType)}` },
    ];

    for (const { name, url } of pages) {
      const page = await context.newPage();
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });

      // wait for map tiles to load if there's a map
      const hasMap = await page.$(".map-container, .cluster-map-container");
      if (hasMap) {
        await page.waitForTimeout(2000);
      }

      // wait for charts to render
      const hasChart = await page.$(".chart-canvas");
      if (hasChart) {
        await page.waitForTimeout(500);
      }

      const filePath = path.join(DOCS_DIR, `${name}.png`);
      await page.screenshot({ path: filePath });
      console.log(`Saved ${filePath}`);
      await page.close();
    }

    await browser.close();
  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
