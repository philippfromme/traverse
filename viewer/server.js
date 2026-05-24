import { execFileSync } from "child_process";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { XMLParser } from "fast-xml-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GPX_DIR = path.resolve("gpx");
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_FILE = path.resolve("activity-index.json");
const HEATMAP_FILE = path.resolve("heatmap-data.json");
const PORT = 3000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function parseGpxFile(filePath) {
  const xml = fs.readFileSync(filePath, "utf-8");
  const parsed = parser.parse(xml);
  const gpx = parsed.gpx;

  if (!gpx) return null;

  const metadata = gpx.metadata || {};
  const trk = gpx.trk || {};
  const name = trk.name || "Unnamed";
  const type = trk.type || "unknown";
  const time = metadata.time || null;

  // extract trackpoints
  const trkseg = trk.trkseg || {};
  let trkpts = trkseg.trkpt || [];

  if (!Array.isArray(trkpts)) {
    trkpts = trkpts ? [trkpts] : [];
  }

  const trackpoints = trkpts.map((pt) => {
    const ext = pt.extensions?.["ns3:TrackPointExtension"] || {};

    return {
      lat: parseFloat(pt["@_lat"]),
      lon: parseFloat(pt["@_lon"]),
      ele: pt.ele != null ? parseFloat(pt.ele) : null,
      time: pt.time || null,
      hr: ext["ns3:hr"] != null ? parseInt(ext["ns3:hr"], 10) : null,
    };
  });

  return {
    name,
    type,
    time,
    hasTrack: trackpoints.length > 0,
    trackpointCount: trackpoints.length,
    trackpoints,
  };
}

function buildIndex() {
  console.log("Index not found, building...");
  execFileSync(process.execPath, [path.resolve("scripts/build-index.js")], {
    stdio: "inherit",
  });
}

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    buildIndex();
  }

  const activities = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  console.log(`Loaded ${activities.length} activities from index.`);
  return activities;
}

const activityIndex = loadIndex();

// collect unique types for filter dropdown
const activityTypes = [...new Set(activityIndex.map((a) => a.type))]
  .filter(Boolean)
  .sort();

// build summary stats grouped by type
function buildSummary(activities) {
  const byType = {};
  let totalDistance = 0;
  let totalDuration = 0;
  let totalCount = activities.length;

  for (const a of activities) {
    if (!byType[a.type]) {
      byType[a.type] = { count: 0, distance: 0, duration: 0 };
    }
    byType[a.type].count++;
    byType[a.type].distance += a.distance || 0;
    byType[a.type].duration += a.duration || 0;
    totalDistance += a.distance || 0;
    totalDuration += a.duration || 0;
  }

  return {
    totalCount,
    totalDistance,
    totalDuration,
    byType,
  };
}

const activitySummary = buildSummary(activityIndex);

const app = express();

app.use(
  "/fonts/mozilla-text",
  express.static(
    path.join(__dirname, "../node_modules/@fontsource/mozilla-text"),
  ),
);
app.use(
  "/fonts/mozilla-headline",
  express.static(
    path.join(__dirname, "../node_modules/@fontsource/mozilla-headline"),
  ),
);
app.use(
  "/fonts/material-symbols",
  express.static(path.join(__dirname, "../node_modules/material-symbols")),
);

app.use(express.static(PUBLIC_DIR));

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// API: summary stats
app.get("/api/summary", (req, res) => {
  res.json(activitySummary);
});

// API: list activities
app.get("/api/activities", (req, res) => {
  let results = activityIndex;
  const { search, type } = req.query;

  if (search) {
    const q = search.toLowerCase();
    results = results.filter((a) => a.name.toLowerCase().includes(q));
  }

  if (type) {
    results = results.filter((a) => a.type === type);
  }

  res.json({ activities: results, types: activityTypes });
});

// API: single activity with full trackpoints
app.get("/api/activities/:id", (req, res) => {
  const activityId = req.params.id;
  const filePath = path.join(GPX_DIR, `${activityId}.gpx`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Activity not found" });
  }

  try {
    const data = parseGpxFile(filePath);

    // enrich with index metadata
    const indexed = activityIndex.find((a) => a.id === activityId);
    const location = indexed?.location || null;
    const maxSpeed = indexed?.maxSpeed || null;

    res.json({ id: activityId, location, maxSpeed, ...data });
  } catch (err) {
    res.status(500).json({ error: `Failed to parse GPX: ${err.message}` });
  }
});

// API: lightweight track coords only (for feed map previews)
app.get("/api/activities/:id/track", (req, res) => {
  const activityId = req.params.id;
  const filePath = path.join(GPX_DIR, `${activityId}.gpx`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Activity not found" });
  }

  try {
    const data = parseGpxFile(filePath);
    // downsample to every Nth point for preview
    const step = Math.max(1, Math.floor(data.trackpoints.length / 200));
    const coords = data.trackpoints
      .filter((_, i) => i % step === 0)
      .map((pt) => [pt.lat, pt.lon]);

    res.json({ coords });
  } catch (err) {
    res.status(500).json({ error: `Failed to parse GPX: ${err.message}` });
  }
});

// Load pre-computed heatmap data
function loadHeatmapData() {
  if (!fs.existsSync(HEATMAP_FILE)) {
    console.log("Heatmap data not found, building index...");
    buildIndex();
  }

  const byType = JSON.parse(fs.readFileSync(HEATMAP_FILE, "utf-8"));
  const allPoints = [];
  for (const points of Object.values(byType)) {
    allPoints.push(...points);
  }
  console.log(`Loaded ${allPoints.length} heatmap points.`);
  return { allPoints, byType };
}

const heatmapData = loadHeatmapData();

// API: heatmap data (downsampled trackpoints from all activities)
app.get("/api/heatmap", (req, res) => {
  const { type } = req.query;
  const points = type && heatmapData.byType[type]
    ? heatmapData.byType[type]
    : heatmapData.allPoints;

  const features = points.map((coord) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: coord },
    properties: {},
  }));

  res.json({
    type: "FeatureCollection",
    features,
    types: activityTypes,
  });
});

// SPA fallback: serve index.html for /activity/:id routes
app.get("/activity/:id", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "activity.html"));
});

app.get("/activities", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "activities.html"));
});

app.get("/calendar", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "calendar.html"));
});

app.get("/heatmap", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "heatmap.html"));
});

app.get("/stats", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "stats.html"));
});

app.get("/stats/:type", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "stats-type.html"));
});

const server = app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Viewer running at ${url}`);

  const { default: open } = await import("open");
  open(url);
});

// keep the process alive
server.on("error", (err) => {
  console.error("Server error:", err.message);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});
