import { execFile } from "child_process";
import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { XMLParser } from "fast-xml-parser";
import FitParser from "fit-file-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || "./cache");
const FIT_DIR = path.join(DATA_DIR, "fit");
const GPX_DIR = path.join(DATA_DIR, "gpx");
const TCX_DIR = path.join(DATA_DIR, "tcx");
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_FILE = path.join(CACHE_DIR, "activity-index.json");
const HEATMAP_FILE = path.join(CACHE_DIR, "heatmap-data.json");
const PORT = 3000;

console.log(`[config] DATA_DIR=${DATA_DIR}`);
console.log(`[config] CACHE_DIR=${CACHE_DIR}`);
console.log(`[config] FIT_DIR=${FIT_DIR}`);
console.log(`[config] GPX_DIR=${GPX_DIR}`);
console.log(`[config] TCX_DIR=${TCX_DIR}`);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});
const fitParser = new FitParser({ force: true, mode: "cascade" });

async function parseFitFileForServer(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return new Promise((resolve, reject) => {
    fitParser.parse(buf, (err, data) => {
      if (err) return reject(new Error(String(err)));
      const session = data?.activity?.sessions?.[0];
      if (!session) return resolve(null);

      const trackpoints = [];
      for (const lap of session.laps || []) {
        for (const rec of lap.records || []) {
          if (rec.position_lat != null && rec.position_long != null) {
            trackpoints.push({
              lat: rec.position_lat,
              lon: rec.position_long,
              ele: rec.enhanced_altitude ?? null,
              time: rec.timestamp ? new Date(rec.timestamp).toISOString() : null,
              hr: rec.heart_rate ?? null,
            });
          }
        }
      }

      resolve({
        type: session.sport || "unknown",
        time: session.start_time ? new Date(session.start_time).toISOString() : null,
        hasTrack: trackpoints.length > 0,
        trackpointCount: trackpoints.length,
        trackpoints,
      });
    });
  });
}

function parseGpxFile(filePath) {
  const xml = fs.readFileSync(filePath, "utf-8");
  const parsed = parser.parse(xml);
  const gpx = parsed.gpx;

  if (!gpx) return null;

  const metadata = gpx.metadata || {};
  const rawTrk = gpx.trk || {};
  const trk = Array.isArray(rawTrk) ? rawTrk[0] : rawTrk;
  const name = trk.name || "Unnamed";
  const type = trk.type || "unknown";
  const time = metadata.time || null;

  // extract trackpoints (merge all segments across all tracks)
  const allTrks = Array.isArray(rawTrk) ? rawTrk : [rawTrk];
  let trkpts = [];
  for (const t of allTrks) {
    const trkseg = t.trkseg || {};
    const pts = trkseg.trkpt || [];
    trkpts = trkpts.concat(Array.isArray(pts) ? pts : pts ? [pts] : []);
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
  return new Promise((resolve, reject) => {
    console.log("Building index...");
    execFile(
      process.execPath,
      [path.resolve("scripts/build-index.js")],
      { env: { ...process.env, DATA_DIR: DATA_DIR } },
      (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function loadIndex() {
  const activities = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  console.log(`Loaded ${activities.length} activities from index.`);
  return activities;
}

if (!fs.existsSync(INDEX_FILE) || !fs.existsSync(HEATMAP_FILE)) {
  try {
    await buildIndex();
  } catch (err) {
    console.error("Failed to build index on startup:", err.message);
    process.exit(1);
  }
}

let activityIndex = loadIndex();

// collect unique types for filter dropdown
let activityTypes = [...new Set(activityIndex.map((a) => a.type))]
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

let activitySummary = buildSummary(activityIndex);

const app = express();

app.use(
  "/fonts/geist-sans",
  express.static(
    path.join(__dirname, "../node_modules/geist/dist/fonts/geist-sans"),
  ),
);
app.use(
  "/fonts/geist-pixel",
  express.static(
    path.join(__dirname, "../node_modules/geist/dist/fonts/geist-pixel"),
  ),
);
app.use(
  "/fonts/material-symbols",
  express.static(path.join(__dirname, "../node_modules/material-symbols")),
);

app.use(express.static(PUBLIC_DIR));

// API: upload a GPX, TCX, or FIT file
app.post("/api/upload", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
  const originalName = req.query.filename || "";
  console.log(`[upload] filename=${originalName} body type=${typeof req.body} body length=${req.body?.length ?? "n/a"}`);
  // only take the basename to prevent path traversal
  const basename = path.basename(originalName);
  const ext = path.extname(basename).toLowerCase();

  const allowed = { ".gpx": GPX_DIR, ".tcx": TCX_DIR, ".fit": FIT_DIR };
  if (!allowed[ext]) {
    console.log(`[upload] rejected: unsupported extension "${ext}"`);
    return res.status(400).json({ error: "Only .gpx, .tcx, or .fit files are supported" });
  }

  // validate filename is safe (alphanumeric, hyphens, underscores, dots only)
  if (!/^[\w.-]+$/.test(basename)) {
    console.log(`[upload] rejected: unsafe filename "${basename}"`);
    return res.status(400).json({ error: "Invalid filename" });
  }

  const targetDir = allowed[ext];

  if (!fs.existsSync(targetDir)) {
    console.log(`[upload] creating directory ${targetDir}`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const destPath = path.join(targetDir, basename);
  const replace = req.query.replace === "true";
  console.log(`[upload] destPath=${destPath} replace=${replace} exists=${fs.existsSync(destPath)}`);

  if (fs.existsSync(destPath) && !replace) {
    console.log(`[upload] conflict: file already exists`);
    return res.status(409).json({ conflict: true, filename: basename });
  }

  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      console.error(`[upload] body is not a Buffer: type=${typeof req.body} value=${req.body}`);
      return res.status(400).json({ error: "Request body is empty or was not parsed as binary" });
    }
    await fs.promises.writeFile(destPath, req.body);
    const id = path.basename(basename, ext);
    console.log(`[upload] saved ${destPath} (${req.body.length} bytes), id=${id}`);
    res.json({ filename: basename, id });
  } catch (err) {
    console.error(`[upload] writeFile failed:`, err);
    res.status(500).json({ error: `Failed to save file: ${err.message}` });
  }
});

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
app.get("/api/activities/:id", async (req, res) => {
  const activityId = req.params.id;
  if (!/^[\w-]+$/.test(activityId)) return res.status(400).json({ error: "Invalid id" });
  const gpxPath = path.join(GPX_DIR, `${activityId}.gpx`);
  const fitPath = path.join(FIT_DIR, `${activityId}.fit`);

  const indexed = activityIndex.find((a) => a.id === activityId);
  const location = indexed?.location || null;
  const maxSpeed = indexed?.maxSpeed || null;

  if (fs.existsSync(gpxPath)) {
    try {
      const data = parseGpxFile(gpxPath);
      res.json({ id: activityId, location, maxSpeed, ...data });
    } catch (err) {
      res.status(500).json({ error: `Failed to parse GPX: ${err.message}` });
    }
  } else if (fs.existsSync(fitPath)) {
    try {
      const data = await parseFitFileForServer(fitPath);
      if (!data) return res.status(404).json({ error: "Activity not found" });
      res.json({
        id: activityId,
        location,
        maxSpeed,
        name: indexed?.name || data.type,
        ...data,
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to parse FIT: ${err.message}` });
    }
  } else {
    res.status(404).json({ error: "Activity not found" });
  }
});

// API: lightweight track coords only (for feed map previews)
app.get("/api/activities/:id/track", async (req, res) => {
  const activityId = req.params.id;
  if (!/^[\w-]+$/.test(activityId)) return res.status(400).json({ error: "Invalid id" });
  const gpxPath = path.join(GPX_DIR, `${activityId}.gpx`);
  const fitPath = path.join(FIT_DIR, `${activityId}.fit`);

  let trackpoints = null;

  if (fs.existsSync(gpxPath)) {
    try {
      const data = parseGpxFile(gpxPath);
      trackpoints = data.trackpoints;
    } catch (err) {
      return res.status(500).json({ error: `Failed to parse GPX: ${err.message}` });
    }
  } else if (fs.existsSync(fitPath)) {
    try {
      const data = await parseFitFileForServer(fitPath);
      trackpoints = data?.trackpoints ?? [];
    } catch (err) {
      return res.status(500).json({ error: `Failed to parse FIT: ${err.message}` });
    }
  } else {
    return res.status(404).json({ error: "Activity not found" });
  }

  // downsample to every Nth point for preview
  const step = Math.max(1, Math.floor(trackpoints.length / 200));
  const coords = trackpoints
    .filter((_, i) => i % step === 0)
    .map((pt) => [pt.lat, pt.lon]);

  res.json({ coords });
});

// Load pre-computed heatmap data
function loadHeatmapData() {
  const byType = JSON.parse(fs.readFileSync(HEATMAP_FILE, "utf-8"));
  const allPoints = [];
  for (const points of Object.values(byType)) {
    for (const pt of points) allPoints.push(pt);
  }
  console.log(`Loaded ${allPoints.length} heatmap points.`);
  return { allPoints, byType };
}

let heatmapData = loadHeatmapData();

// watch data files for changes and reload
function reloadData() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      activityIndex = loadIndex();
      activityTypes = [...new Set(activityIndex.map((a) => a.type))]
        .filter(Boolean)
        .sort();
      activitySummary = buildSummary(activityIndex);
    }
    if (fs.existsSync(HEATMAP_FILE)) {
      heatmapData = loadHeatmapData();
    }
  } catch (err) {
    console.error("Failed to reload data:", err.message);
  }
}

let reloadTimer = null;
function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadData, 500);
}

for (const file of [INDEX_FILE, HEATMAP_FILE]) {
  if (fs.existsSync(file)) {
    fs.watch(file, () => scheduleReload());
  }
}

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

app.get("/upload", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "upload.html"));
});

const server = app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Viewer running at ${url}`);

  try {
    const { default: open } = await import("open");
    open(url);
  } catch {}
});

// keep the process alive
server.on("error", (err) => {
  console.error("Server error:", err.message);
  process.exit(1);
});

// Watch data directories and rebuild index when new files are dropped
let rebuildTimer = null;
let rebuilding = false;

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    if (rebuilding) {
      console.log("[rebuild] already in progress, skipping");
      return;
    }
    rebuilding = true;
    console.log("[rebuild] starting index rebuild...");
    try {
      await buildIndex();
      reloadData();
      console.log("[rebuild] done.");
    } catch (err) {
      console.error("[rebuild] failed:", err.message);
    } finally {
      rebuilding = false;
    }
  }, 2000);
}

for (const dir of [FIT_DIR, GPX_DIR, TCX_DIR]) {
  if (fs.existsSync(dir)) {
    console.log(`[watch] watching ${dir}`);
    fs.watch(dir, (eventType, filename) => {
      console.log(`[watch] ${dir} event=${eventType} file=${filename}`);
      if (eventType === "rename") scheduleRebuild();
    });
  }
}

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});
