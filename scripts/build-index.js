import "dotenv/config";
import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import FitParser from "fit-file-parser";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || "./cache");
const GPX_DIR = path.join(DATA_DIR, "gpx");
const TCX_DIR = path.join(DATA_DIR, "tcx");
const FIT_DIR = path.join(DATA_DIR, "fit");
const INDEX_FILE = path.join(CACHE_DIR, "activity-index.json");
const HEATMAP_FILE = path.join(CACHE_DIR, "heatmap-data.json");
const NOMINATIM_DELAY_MS = 1500; // Nominatim requires max 1 req/s, use 1.5s for safety

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

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeDistance(trackpoints) {
  let total = 0;
  for (let i = 1; i < trackpoints.length; i++) {
    total += haversineDistance(
      trackpoints[i - 1].lat,
      trackpoints[i - 1].lon,
      trackpoints[i].lat,
      trackpoints[i].lon,
    );
  }
  return total;
}

function computeDuration(trackpoints) {
  if (trackpoints.length < 2) return null;
  const first = trackpoints[0].time;
  const last = trackpoints[trackpoints.length - 1].time;
  if (!first || !last) return null;
  return (new Date(last) - new Date(first)) / 1000;
}

function computeMaxSpeed(trackpoints, windowSize = 5) {
  if (trackpoints.length < 2) return null;

  let maxSpeed = 0;

  for (let i = windowSize; i < trackpoints.length; i++) {
    const start = trackpoints[i - windowSize];
    const end = trackpoints[i];

    if (!start.time || !end.time) continue;

    const dt = (new Date(end.time) - new Date(start.time)) / 1000;
    if (dt <= 0) continue;

    const dist = haversineDistance(start.lat, start.lon, end.lat, end.lon);
    const speed = dist / dt; // m/s

    if (speed > maxSpeed) {
      maxSpeed = speed;
    }
  }

  return maxSpeed > 0 ? maxSpeed : null;
}

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

  const trkseg = trk.trkseg || {};
  let trkpts = trkseg.trkpt || [];

  if (!Array.isArray(trkpts)) {
    trkpts = trkpts ? [trkpts] : [];
  }

  const trackpoints = trkpts.map((pt) => ({
    lat: parseFloat(pt["@_lat"]),
    lon: parseFloat(pt["@_lon"]),
    time: pt.time || null,
  }));

  return {
    name,
    type,
    time,
    hasTrack: trackpoints.length > 0,
    trackpointCount: trackpoints.length,
    trackpoints,
    startLat: trackpoints.length > 0 ? trackpoints[0].lat : null,
    startLon: trackpoints.length > 0 ? trackpoints[0].lon : null,
  };
}

function parseTcxFile(filePath) {
  const xml = fs.readFileSync(filePath, "utf-8");
  const parsed = parser.parse(xml);
  const db = parsed.TrainingCenterDatabase;

  if (!db) return null;

  const activity = db.Activities?.Activity;
  if (!activity) return null;

  const time = activity.Id || null;
  const type = (activity["@_Sport"] || "unknown").toLowerCase();

  let laps = activity.Lap;
  if (!Array.isArray(laps)) {
    laps = laps ? [laps] : [];
  }

  // aggregate lap data
  let totalDuration = 0;
  let totalDistance = 0;
  let totalCalories = 0;
  let weightedHrSum = 0;
  let hrDurationSum = 0;
  let maxHR = 0;

  for (const lap of laps) {
    const lapDuration = parseFloat(lap.TotalTimeSeconds) || 0;
    totalDuration += lapDuration;
    totalDistance += parseFloat(lap.DistanceMeters) || 0;
    totalCalories += parseInt(lap.Calories) || 0;

    const avgHr = parseInt(lap.AverageHeartRateBpm?.Value);
    if (avgHr) {
      weightedHrSum += avgHr * lapDuration;
      hrDurationSum += lapDuration;
    }

    const lapMaxHr = parseInt(lap.MaximumHeartRateBpm?.Value);
    if (lapMaxHr && lapMaxHr > maxHR) {
      maxHR = lapMaxHr;
    }
  }

  const averageHR = hrDurationSum > 0 ? Math.round(weightedHrSum / hrDurationSum) : null;

  // extract trackpoints for GPS data
  const trackpoints = [];
  for (const lap of laps) {
    let tracks = lap.Track;
    if (!tracks) continue;
    if (!Array.isArray(tracks)) tracks = [tracks];

    for (const track of tracks) {
      let trkpts = track.Trackpoint;
      if (!trkpts) continue;
      if (!Array.isArray(trkpts)) trkpts = [trkpts];

      for (const pt of trkpts) {
        const pos = pt.Position;
        if (pos) {
          trackpoints.push({
            lat: parseFloat(pos.LatitudeDegrees),
            lon: parseFloat(pos.LongitudeDegrees),
            time: pt.Time || null,
          });
        }
      }
    }
  }

  return {
    time,
    type,
    duration: totalDuration || null,
    distance: totalDistance,
    calories: totalCalories || null,
    averageHR,
    maxHR: maxHR || null,
    hasTrack: trackpoints.length > 0,
    trackpointCount: trackpoints.length,
    trackpoints,
    startLat: trackpoints.length > 0 ? trackpoints[0].lat : null,
    startLon: trackpoints.length > 0 ? trackpoints[0].lon : null,
  };
}

function fitSportToType(sport, subSport) {
  if (subSport && typeof subSport === "string" && subSport !== "generic") {
    return subSport;
  }
  return sport || "unknown";
}

function capitalizeType(type) {
  return (type || "unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseFitFile(filePath) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(filePath);
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
        type: fitSportToType(session.sport, session.sub_sport),
        time: session.start_time ? new Date(session.start_time).toISOString() : null,
        duration: session.total_elapsed_time ?? null,
        distance: session.total_distance ?? null,
        calories: session.total_calories || null,
        averageHR: session.avg_heart_rate || null,
        maxHR: session.max_heart_rate || null,
        hasTrack: trackpoints.length > 0,
        trackpointCount: trackpoints.length,
        trackpoints,
        startLat: trackpoints.length > 0 ? trackpoints[0].lat : null,
        startLon: trackpoints.length > 0 ? trackpoints[0].lon : null,
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reverseGeocode(lat, lon, retries = 5) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "BasaltTraverse/0.1 (https://github.com/philippfromme/traverse)",
        Accept: "application/json",
      },
    });

    if (res.status === 429) {
      const wait = 5000 * (attempt + 1);
      console.warn(`    Rate limited, retrying in ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      console.warn(`    HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.warn(`    Non-JSON response, retrying...`);
      await sleep(3000);
      continue;
    }

    console.log(`    Geocoded to: ${data.display_name}`);

    const addr = data.address || {};

    // build a short location string: city/town, state/region, country
    const city =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.county;
    const state = addr.state;
    const country = addr.country;

    const parts = [city, state, country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  return null;
}

async function main() {
  const startTime = Date.now();

  // 1. Load file lists
  const fitStems = fs.existsSync(FIT_DIR)
    ? fs.readdirSync(FIT_DIR).filter((f) => f.endsWith(".fit")).map((f) => path.basename(f, ".fit"))
    : [];
  const tcxStems = fs.existsSync(TCX_DIR)
    ? fs.readdirSync(TCX_DIR).filter((f) => f.endsWith(".tcx")).map((f) => path.basename(f, ".tcx"))
    : [];
  const gpxStems = fs.existsSync(GPX_DIR)
    ? fs.readdirSync(GPX_DIR).filter((f) => f.endsWith(".gpx")).map((f) => path.basename(f, ".gpx"))
    : [];

  console.log(`Found ${fitStems.length} FIT, ${tcxStems.length} TCX, ${gpxStems.length} GPX files.`);

  // 2. Load existing index
  let existingIndex = {};
  if (fs.existsSync(INDEX_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
      for (const a of existing) existingIndex[a.id] = a;
    } catch {
      // ignore corrupt index
    }
  }

  // 3. Split each format into unchanged (in index with correct source) vs new.
  //    "source" is the cache-invalidation key; absent on old entries → re-index.
  //    Stale entries (file deleted) are excluded — activities is built fresh from current files.
  const newFitStems = [], unchangedFitStems = [];
  for (const stem of fitStems) {
    if (existingIndex[stem]?.source === "fit") unchangedFitStems.push(stem);
    else newFitStems.push(stem);
  }

  const newTcxStems = [], unchangedTcxStems = [];
  for (const stem of tcxStems) {
    if (existingIndex[stem]?.source === "tcx") unchangedTcxStems.push(stem);
    else newTcxStems.push(stem);
  }

  const newGpxStems = [], unchangedGpxStems = [];
  for (const stem of gpxStems) {
    if (existingIndex[stem]?.source === "gpx") unchangedGpxStems.push(stem);
    else newGpxStems.push(stem);
  }

  console.log(
    `FIT: ${unchangedFitStems.length} cached + ${newFitStems.length} new. ` +
    `TCX: ${unchangedTcxStems.length} cached + ${newTcxStems.length} new. ` +
    `GPX: ${unchangedGpxStems.length} cached + ${newGpxStems.length} new.`,
  );

  // 4. Parse only new files
  const fitDataMap = new Map(); // new FIT stems only
  for (const stem of newFitStems) {
    try {
      const data = await parseFitFile(path.join(FIT_DIR, `${stem}.fit`));
      if (data) fitDataMap.set(stem, data);
    } catch (err) {
      console.warn(`  Failed to parse FIT ${stem}: ${err.message}`);
    }
  }

  const parsedNewTcxMap = new Map();
  for (const stem of newTcxStems) {
    try {
      const data = parseTcxFile(path.join(TCX_DIR, `${stem}.tcx`));
      if (data) parsedNewTcxMap.set(stem, data);
    } catch (err) {
      console.warn(`  Failed to parse TCX ${stem}: ${err.message}`);
    }
  }

  const parsedNewGpxMap = new Map();
  for (const stem of newGpxStems) {
    try {
      const data = parseGpxFile(path.join(GPX_DIR, `${stem}.gpx`));
      if (data) parsedNewGpxMap.set(stem, data);
    } catch (err) {
      console.warn(`  Failed to parse GPX ${stem}: ${err.message}`);
    }
  }

  // 5. Heatmap
  const newActivityCount = newFitStems.length + newTcxStems.length + newGpxStems.length;
  const heatmapExists = fs.existsSync(HEATMAP_FILE);
  const needsHeatmapRebuild = !heatmapExists;
  const needsHeatmapAppend = heatmapExists && newActivityCount > 0;

  function addToHeatmap(heatmapByType, trackpoints, type) {
    if (!trackpoints || trackpoints.length === 0) return 0;
    const key = type ?? "unknown";
    if (!heatmapByType[key]) heatmapByType[key] = [];
    const step = Math.max(1, Math.floor(trackpoints.length / 100));
    let count = 0;
    for (let j = 0; j < trackpoints.length; j += step) {
      const pt = trackpoints[j];
      heatmapByType[key].push([pt.lon, pt.lat]);
      count++;
    }
    return count;
  }

  if (needsHeatmapRebuild) {
    console.log(`Building heatmap data from scratch...`);
    const heatmapByType = {};
    let totalPoints = 0;

    for (let i = 0; i < fitStems.length; i++) {
      if (i > 0 && i % 500 === 0) console.log(`  Heatmap FIT: ${i}/${fitStems.length}...`);
      const stem = fitStems[i];
      try {
        const d = fitDataMap.get(stem) ?? await parseFitFile(path.join(FIT_DIR, `${stem}.fit`));
        if (d?.hasTrack) totalPoints += addToHeatmap(heatmapByType, d.trackpoints, d.type);
      } catch (err) {
        console.warn(`  Heatmap FIT ${stem}: ${err.message}`);
      }
    }
    for (let i = 0; i < tcxStems.length; i++) {
      if (i > 0 && i % 500 === 0) console.log(`  Heatmap TCX: ${i}/${tcxStems.length}...`);
      const stem = tcxStems[i];
      try {
        const d = parsedNewTcxMap.get(stem) ?? parseTcxFile(path.join(TCX_DIR, `${stem}.tcx`));
        if (d?.hasTrack) totalPoints += addToHeatmap(heatmapByType, d.trackpoints, d.type);
      } catch (err) {
        console.warn(`  Heatmap TCX ${stem}: ${err.message}`);
      }
    }
    for (let i = 0; i < gpxStems.length; i++) {
      if (i > 0 && i % 500 === 0) console.log(`  Heatmap GPX: ${i}/${gpxStems.length}...`);
      const stem = gpxStems[i];
      try {
        const d = parsedNewGpxMap.get(stem) ?? parseGpxFile(path.join(GPX_DIR, `${stem}.gpx`));
        if (d?.hasTrack) totalPoints += addToHeatmap(heatmapByType, d.trackpoints, d.type);
      } catch (err) {
        console.warn(`  Heatmap GPX ${stem}: ${err.message}`);
      }
    }

    console.log(`  Heatmap: ${totalPoints} points across ${Object.keys(heatmapByType).length} types.`);
    fs.writeFileSync(HEATMAP_FILE, JSON.stringify(heatmapByType));
  } else if (needsHeatmapAppend) {
    console.log(`Appending new activities to heatmap...`);
    const heatmapByType = JSON.parse(fs.readFileSync(HEATMAP_FILE, "utf-8"));
    let newPoints = 0;

    for (const [, d] of fitDataMap) {
      if (d.hasTrack) newPoints += addToHeatmap(heatmapByType, d.trackpoints, d.type);
    }
    for (const [, d] of parsedNewTcxMap) {
      if (d.hasTrack) newPoints += addToHeatmap(heatmapByType, d.trackpoints, d.type);
    }
    for (const [, d] of parsedNewGpxMap) {
      if (d.hasTrack) newPoints += addToHeatmap(heatmapByType, d.trackpoints, d.type);
    }

    console.log(`  Appended ${newPoints} new heatmap points.`);
    fs.writeFileSync(HEATMAP_FILE, JSON.stringify(heatmapByType));
  } else {
    console.log(`Heatmap up to date.`);
  }

  // 6. Build activities array
  const activities = [];

  // Unchanged activities — copy from index as-is
  for (const stem of [...unchangedFitStems, ...unchangedTcxStems, ...unchangedGpxStems]) {
    activities.push({ ...existingIndex[stem] });
  }

  // New FIT activities
  for (const [stem, d] of fitDataMap) {
    const hasTrack = d.hasTrack;
    const distance = d.distance ?? (hasTrack ? computeDistance(d.trackpoints) : null);
    const maxSpeed = hasTrack ? computeMaxSpeed(d.trackpoints) : null;
    activities.push({
      id: stem,
      source: "fit",
      name: capitalizeType(d.type),
      type: d.type,
      time: d.time,
      hasTrack,
      trackpointCount: d.trackpointCount,
      distance,
      duration: d.duration,
      maxSpeed,
      averageHR: d.averageHR,
      maxHR: d.maxHR,
      calories: d.calories,
      startLat: d.startLat,
      startLon: d.startLon,
      location: existingIndex[stem]?.location ?? null,
    });
  }

  // New TCX activities
  for (const [stem, d] of parsedNewTcxMap) {
    const hasTrack = d.hasTrack;
    const distance = d.distance ?? (hasTrack ? computeDistance(d.trackpoints) : null);
    const duration = d.duration ?? (hasTrack ? computeDuration(d.trackpoints) : null);
    const maxSpeed = hasTrack ? computeMaxSpeed(d.trackpoints) : null;
    activities.push({
      id: stem,
      source: "tcx",
      name: capitalizeType(d.type),
      type: d.type,
      time: d.time,
      hasTrack,
      trackpointCount: d.trackpointCount,
      distance,
      duration,
      maxSpeed,
      averageHR: d.averageHR,
      maxHR: d.maxHR,
      calories: d.calories,
      startLat: d.startLat,
      startLon: d.startLon,
      location: existingIndex[stem]?.location ?? null,
    });
  }

  // New GPX activities
  for (const [stem, d] of parsedNewGpxMap) {
    const hasTrack = d.hasTrack;
    const distance = hasTrack ? computeDistance(d.trackpoints) : null;
    const duration = hasTrack ? computeDuration(d.trackpoints) : null;
    const maxSpeed = hasTrack ? computeMaxSpeed(d.trackpoints) : null;
    activities.push({
      id: stem,
      source: "gpx",
      name: d.name,
      type: d.type,
      time: d.time,
      hasTrack,
      trackpointCount: d.trackpointCount,
      distance,
      duration,
      maxSpeed,
      averageHR: null,
      maxHR: null,
      calories: null,
      startLat: d.startLat,
      startLon: d.startLon,
      location: existingIndex[stem]?.location ?? null,
    });
  }

  // 7. Reverse geocode activities that don't have a location yet
  const toGeocode = activities.filter(
    (a) => !a.location && a.startLat != null && a.startLon != null,
  );

  if (toGeocode.length > 0) {
    console.log(`Reverse geocoding ${toGeocode.length} activities...`);

    for (let i = 0; i < toGeocode.length; i++) {
      const a = toGeocode[i];

      try {
        const location = await reverseGeocode(a.startLat, a.startLon);
        a.location = location;

        // FIT and TCX have no user-assigned name — append location
        if (a.source !== "gpx" && location) {
          a.name = `${capitalizeType(a.type)} in ${location}`;
        }

        console.log(
          `  [${i + 1}/${toGeocode.length}] ${a.id}: ${location || "unknown"}`,
        );
      } catch (err) {
        console.warn(
          `  [${i + 1}/${toGeocode.length}] ${a.id}: failed (${err.message})`,
        );
      }

      if ((i + 1) % 50 === 0) {
        fs.writeFileSync(INDEX_FILE, JSON.stringify(activities, null, 2));
        console.log(`  (saved progress)`);
      }

      if (i < toGeocode.length - 1) {
        await sleep(NOMINATIM_DELAY_MS);
      }
    }
  }

  // 8. Sort by date descending and write
  activities.sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return new Date(b.time) - new Date(a.time);
  });

  fs.writeFileSync(INDEX_FILE, JSON.stringify(activities, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Indexed ${activities.length} activities in ${elapsed}s → ${INDEX_FILE}`);
}

main();

