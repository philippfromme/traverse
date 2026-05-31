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
const FIT_MATCH_TOLERANCE_MS = 60 * 1000; // match FIT to GPX/TCX within ±60s

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

    console.log(`    Geocoded to: ${data.display_name}`, data);

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

  // 1. Parse all FIT files upfront
  const fitDataMap = new Map(); // stem → fitParsed
  if (fs.existsSync(FIT_DIR)) {
    const fitFiles = fs.readdirSync(FIT_DIR).filter((f) => f.endsWith(".fit"));
    console.log(`Found ${fitFiles.length} FIT files, parsing...`);
    for (const f of fitFiles) {
      try {
        const data = await parseFitFile(path.join(FIT_DIR, f));
        if (data) fitDataMap.set(path.basename(f, ".fit"), data);
      } catch (err) {
        console.warn(`  Failed to parse FIT ${f}: ${err.message}`);
      }
    }
    console.log(`  Parsed ${fitDataMap.size} FIT files.`);
  }

  // Build time-based lookup for FIT→GPX/TCX matching
  const fitByTimeMs = [];
  for (const [stem, data] of fitDataMap) {
    if (data.time) fitByTimeMs.push([new Date(data.time).getTime(), stem]);
  }

  function findMatchingFitStem(timeStr) {
    if (!timeStr || fitByTimeMs.length === 0) return null;
    const t = new Date(timeStr).getTime();
    for (const [fitTime, stem] of fitByTimeMs) {
      if (Math.abs(t - fitTime) <= FIT_MATCH_TOLERANCE_MS) return stem;
    }
    return null;
  }

  // 2. Load GPX and TCX file lists
  const gpxFiles = fs.readdirSync(GPX_DIR).filter((f) => f.endsWith(".gpx"));
  const tcxFileSet = fs.existsSync(TCX_DIR)
    ? new Set(fs.readdirSync(TCX_DIR).filter((f) => f.endsWith(".tcx")).map((f) => path.basename(f, ".tcx")))
    : new Set();

  console.log(`Found ${gpxFiles.length} GPX files, ${tcxFileSet.size} TCX files.`);

  // 3. Load existing index
  let existingIndex = {};
  if (fs.existsSync(INDEX_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
      for (const a of existing) {
        existingIndex[a.id] = a;
      }
    } catch {
      // ignore corrupt index
    }
  }

  const gpxFileSet = new Set(gpxFiles.map((f) => path.basename(f, ".gpx")));
  const existingIds = new Set(Object.keys(existingIndex));

  // Split GPX files into new/unchanged
  const newGpxFiles = gpxFiles.filter((f) => !existingIds.has(path.basename(f, ".gpx")));
  const unchangedGpxFiles = gpxFiles.filter((f) => existingIds.has(path.basename(f, ".gpx")));

  // Existing FIT-only activities (in index but not backed by a GPX file)
  const existingFitOnlyActivities = Object.values(existingIndex).filter(
    (a) => !gpxFileSet.has(a.id),
  );

  // 4. Track which FIT stems are matched to a GPX/TCX activity
  const matchedFitStems = new Set();

  // Mark existing FIT-only IDs as already accounted for
  for (const a of existingFitOnlyActivities) {
    if (fitDataMap.has(a.id)) matchedFitStems.add(a.id);
  }

  // Match FIT against unchanged GPX activities (using time already in index)
  for (const file of unchangedGpxFiles) {
    const id = path.basename(file, ".gpx");
    const fitStem = findMatchingFitStem(existingIndex[id]?.time);
    if (fitStem) matchedFitStems.add(fitStem);
  }

  // 5. Pre-parse all new GPX files (cache results to avoid double-parsing)
  //    This must happen before the heatmap step so newFitOnlyStems is complete.
  const parsedNewGpxMap = new Map(); // activityId → { gpxData, tcxData, fitData }
  for (const file of newGpxFiles) {
    const activityId = path.basename(file, ".gpx");
    try {
      const gpxData = parseGpxFile(path.join(GPX_DIR, file));
      if (!gpxData) continue;

      let tcxData = null;
      if (tcxFileSet.has(activityId)) {
        try {
          tcxData = parseTcxFile(path.join(TCX_DIR, `${activityId}.tcx`));
        } catch (err) {
          console.warn(`  Failed to parse TCX for ${activityId}: ${err.message}`);
        }
      }

      const fitStem = findMatchingFitStem(gpxData.time);
      const fitData = fitStem ? fitDataMap.get(fitStem) : null;
      if (fitStem) matchedFitStems.add(fitStem);

      parsedNewGpxMap.set(activityId, { gpxData, tcxData, fitData });
    } catch (err) {
      console.warn(`  Failed to parse ${file}: ${err.message}`);
    }
  }

  // New FIT-only stems: not matched to any GPX activity (new or existing)
  const newFitOnlyStems = [...fitDataMap.keys()].filter(
    (stem) => !matchedFitStems.has(stem),
  );

  console.log(
    `Processing ${parsedNewGpxMap.size} new GPX activities, reusing ${unchangedGpxFiles.length} cached, ` +
    `${existingFitOnlyActivities.length} existing FIT-only, ${newFitOnlyStems.length} new FIT-only.`,
  );

  // 6. Heatmap: use FIT type when a match exists; include FIT-only trackpoints
  const heatmapExists = fs.existsSync(HEATMAP_FILE);
  const needsHeatmapRebuild = !heatmapExists;
  const needsHeatmapAppend = heatmapExists && (parsedNewGpxMap.size > 0 || newFitOnlyStems.length > 0);

  if (needsHeatmapRebuild) {
    console.log(`Building heatmap data from scratch...`);
    const heatmapByType = {};
    let totalPoints = 0;

    // GPX tracks
    for (let i = 0; i < gpxFiles.length; i++) {
      if (i > 0 && i % 500 === 0) {
        console.log(`  Heatmap: processed ${i}/${gpxFiles.length} GPX files...`);
      }

      const file = gpxFiles[i];
      const gpxPath = path.join(GPX_DIR, file);

      try {
        const gpxData = parseGpxFile(gpxPath);
        if (!gpxData || gpxData.trackpoints.length === 0) continue;

        const fitStem = findMatchingFitStem(gpxData.time);
        const type = (fitStem ? fitDataMap.get(fitStem)?.type : null) ?? gpxData.type ?? "unknown";
        if (!heatmapByType[type]) heatmapByType[type] = [];

        const step = Math.max(1, Math.floor(gpxData.trackpoints.length / 100));
        for (let j = 0; j < gpxData.trackpoints.length; j += step) {
          const pt = gpxData.trackpoints[j];
          heatmapByType[type].push([pt.lon, pt.lat]);
          totalPoints++;
        }
      } catch (err) {
        console.warn(`  Failed to parse ${file}: ${err.message}`);
      }
    }

    // FIT-only tracks (all, since this is a full rebuild)
    for (const stem of [...fitDataMap.keys()].filter((stem) => !matchedFitStems.has(stem))) {
      const fitData = fitDataMap.get(stem);
      if (!fitData.hasTrack) continue;
      const type = fitData.type ?? "unknown";
      if (!heatmapByType[type]) heatmapByType[type] = [];
      const step = Math.max(1, Math.floor(fitData.trackpoints.length / 100));
      for (let j = 0; j < fitData.trackpoints.length; j += step) {
        const pt = fitData.trackpoints[j];
        heatmapByType[type].push([pt.lon, pt.lat]);
        totalPoints++;
      }
    }

    console.log(`  Heatmap: ${totalPoints} points across ${Object.keys(heatmapByType).length} types.`);
    fs.writeFileSync(HEATMAP_FILE, JSON.stringify(heatmapByType));
  } else if (needsHeatmapAppend) {
    console.log(`Appending new activities to heatmap...`);
    const heatmapByType = JSON.parse(fs.readFileSync(HEATMAP_FILE, "utf-8"));
    let newPoints = 0;

    // New GPX tracks (use cached parsed data)
    for (const [, { gpxData, fitData }] of parsedNewGpxMap) {
      if (!gpxData || gpxData.trackpoints.length === 0) continue;

      const type = fitData?.type ?? gpxData.type ?? "unknown";
      if (!heatmapByType[type]) heatmapByType[type] = [];

      const step = Math.max(1, Math.floor(gpxData.trackpoints.length / 100));
      for (let j = 0; j < gpxData.trackpoints.length; j += step) {
        const pt = gpxData.trackpoints[j];
        heatmapByType[type].push([pt.lon, pt.lat]);
        newPoints++;
      }
    }

    // New FIT-only tracks
    for (const stem of newFitOnlyStems) {
      const fitData = fitDataMap.get(stem);
      if (!fitData.hasTrack) continue;
      const type = fitData.type ?? "unknown";
      if (!heatmapByType[type]) heatmapByType[type] = [];
      const step = Math.max(1, Math.floor(fitData.trackpoints.length / 100));
      for (let j = 0; j < fitData.trackpoints.length; j += step) {
        const pt = fitData.trackpoints[j];
        heatmapByType[type].push([pt.lon, pt.lat]);
        newPoints++;
      }
    }

    console.log(`  Appended ${newPoints} new heatmap points.`);
    fs.writeFileSync(HEATMAP_FILE, JSON.stringify(heatmapByType));
  } else {
    console.log(`Heatmap up to date.`);
  }

  // 7. Build activities array, starting with unchanged GPX activities.
  //    Re-enrich metrics with FIT data if a match is found.
  const activities = [];

  for (const file of unchangedGpxFiles) {
    const id = path.basename(file, ".gpx");
    const activity = { ...existingIndex[id] };
    const fitStem = findMatchingFitStem(activity.time);
    if (fitStem) {
      const fitData = fitDataMap.get(fitStem);
      activity.type = fitData.type ?? activity.type;
      activity.duration = fitData.duration ?? activity.duration;
      activity.distance = fitData.distance ?? activity.distance;
      activity.calories = fitData.calories ?? activity.calories;
      activity.averageHR = fitData.averageHR ?? activity.averageHR;
      activity.maxHR = fitData.maxHR ?? activity.maxHR;
      // update track fields if GPX had no track but FIT does
      if (!activity.hasTrack && fitData.hasTrack) {
        activity.hasTrack = true;
        activity.trackpointCount = fitData.trackpointCount;
        activity.startLat = fitData.startLat;
        activity.startLon = fitData.startLon;
      }
    }
    activities.push(activity);
  }

  // Add existing FIT-only activities
  activities.push(...existingFitOnlyActivities);

  // 8. Index new GPX activities (using pre-parsed cache)
  if (parsedNewGpxMap.size > 0) {
    console.log(`Indexing ${parsedNewGpxMap.size} new GPX activities...`);

    for (const [activityId, { gpxData, tcxData, fitData }] of parsedNewGpxMap) {
      // FIT from watch has no GPS — track data comes from GPX (preferred) or TCX
      const trackpoints = gpxData.hasTrack
        ? gpxData.trackpoints
        : (tcxData?.hasTrack ? tcxData.trackpoints : []);
      const startLat = gpxData.startLat ?? tcxData?.startLat ?? null;
      const startLon = gpxData.startLon ?? tcxData?.startLon ?? null;

      const distance = fitData?.distance ?? tcxData?.distance ?? (trackpoints.length > 0 ? computeDistance(trackpoints) : 0);
      const duration = fitData?.duration ?? tcxData?.duration ?? (trackpoints.length > 0 ? computeDuration(trackpoints) : null);
      const maxSpeed = trackpoints.length > 0 ? computeMaxSpeed(trackpoints) : null;

      activities.push({
        id: activityId,
        name: gpxData.name,
        type: fitData?.type ?? gpxData.type,
        time: fitData?.time ?? gpxData.time,
        hasTrack: trackpoints.length > 0,
        trackpointCount: trackpoints.length,
        distance,
        duration,
        maxSpeed,
        averageHR: fitData?.averageHR ?? tcxData?.averageHR ?? null,
        maxHR: fitData?.maxHR ?? tcxData?.maxHR ?? null,
        calories: fitData?.calories ?? tcxData?.calories ?? null,
        startLat,
        startLon,
        location: null,
      });
    }
  }

  // 9. Add new FIT-only activities
  if (newFitOnlyStems.length > 0) {
    console.log(`Adding ${newFitOnlyStems.length} new FIT-only activities...`);
    for (const stem of newFitOnlyStems) {
      const fitData = fitDataMap.get(stem);
      const distance = fitData.distance ?? (fitData.hasTrack ? computeDistance(fitData.trackpoints) : null);
      const maxSpeed = fitData.hasTrack ? computeMaxSpeed(fitData.trackpoints) : null;
      activities.push({
        id: stem,
        name: capitalizeType(fitData.type),
        type: fitData.type,
        time: fitData.time,
        hasTrack: fitData.hasTrack,
        trackpointCount: fitData.trackpointCount,
        distance,
        duration: fitData.duration,
        maxSpeed,
        averageHR: fitData.averageHR,
        maxHR: fitData.maxHR,
        calories: fitData.calories,
        startLat: fitData.startLat,
        startLon: fitData.startLon,
        location: null,
      });
    }
  }

  // 10. Reverse geocode activities that don't have a location yet
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

        // For FIT-only activities, include location in name
        if (!gpxFileSet.has(a.id) && location) {
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

      // save progress every 50 activities
      if ((i + 1) % 50 === 0) {
        fs.writeFileSync(INDEX_FILE, JSON.stringify(activities, null, 2));
        console.log(`  (saved progress)`);
      }

      if (i < toGeocode.length - 1) {
        await sleep(NOMINATIM_DELAY_MS);
      }
    }
  }

  // 11. Sort by date descending (newest first)
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
