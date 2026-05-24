import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const DATA_DIR = path.resolve(process.env.DATA_DIR || ".");
const GPX_DIR = path.join(DATA_DIR, "gpx");
const TCX_DIR = path.join(DATA_DIR, "tcx");
const INDEX_FILE = path.join(DATA_DIR, "activity-index.json");
const HEATMAP_FILE = path.join(DATA_DIR, "heatmap-data.json");
const NOMINATIM_DELAY_MS = 1500; // Nominatim requires max 1 req/s, use 1.5s for safety

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

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

  const gpxFiles = fs.readdirSync(GPX_DIR).filter((f) => f.endsWith(".gpx"));
  const tcxFiles = fs.existsSync(TCX_DIR)
    ? new Set(fs.readdirSync(TCX_DIR).filter((f) => f.endsWith(".tcx")).map((f) => path.basename(f, ".tcx")))
    : new Set();

  console.log(`Found ${gpxFiles.length} GPX files, ${tcxFiles.size} TCX files.`);

  // load existing index to reuse already-geocoded locations and skip unchanged activities
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

  // determine which activities need (re-)processing
  const existingIds = new Set(Object.keys(existingIndex));
  const newFiles = gpxFiles.filter((f) => !existingIds.has(path.basename(f, ".gpx")));
  const unchangedFiles = gpxFiles.filter((f) => existingIds.has(path.basename(f, ".gpx")));

  console.log(`Processing ${newFiles.length} new activities, reusing ${unchangedFiles.length} cached.`);

  // reuse cached activities
  const activities = unchangedFiles.map((f) => existingIndex[path.basename(f, ".gpx")]);

  // only rebuild heatmap if there are new activities or heatmap file doesn't exist
  const needsHeatmapRebuild = newFiles.length > 0 || !fs.existsSync(HEATMAP_FILE);

  if (needsHeatmapRebuild) {
    console.log(`Building heatmap data...`);
    const heatmapByType = {};
    let totalPoints = 0;

    for (let i = 0; i < gpxFiles.length; i++) {
      if (i > 0 && i % 500 === 0) {
        console.log(`  Heatmap: processed ${i}/${gpxFiles.length} files...`);
      }

      const file = gpxFiles[i];
      const gpxPath = path.join(GPX_DIR, file);
      const isNew = !existingIds.has(path.basename(file, ".gpx"));

      try {
        const gpxData = parseGpxFile(gpxPath);
        if (!gpxData) continue;

        // collect heatmap points
        if (gpxData.trackpoints.length > 0) {
          const type = gpxData.type || "unknown";
          if (!heatmapByType[type]) heatmapByType[type] = [];

          const step = Math.max(1, Math.floor(gpxData.trackpoints.length / 100));
          for (let j = 0; j < gpxData.trackpoints.length; j += step) {
            const pt = gpxData.trackpoints[j];
            heatmapByType[type].push([pt.lon, pt.lat]);
            totalPoints++;
          }
        }

        // only build index entry for new activities
        if (isNew) {
          const activityId = path.basename(file, ".gpx");

          let tcxData = null;
          if (tcxFiles.has(activityId)) {
            try {
              tcxData = parseTcxFile(path.join(TCX_DIR, `${activityId}.tcx`));
            } catch (err) {
              console.warn(`  Failed to parse TCX for ${activityId}: ${err.message}`);
            }
          }

          const distance = gpxData.hasTrack ? computeDistance(gpxData.trackpoints) : (tcxData?.distance ?? 0);
          const gpxDuration = gpxData.hasTrack ? computeDuration(gpxData.trackpoints) : null;
          const maxSpeed = gpxData.hasTrack ? computeMaxSpeed(gpxData.trackpoints) : null;

          activities.push({
            id: activityId,
            name: gpxData.name,
            type: gpxData.type,
            time: gpxData.time,
            hasTrack: gpxData.hasTrack || (tcxData?.hasTrack ?? false),
            trackpointCount: gpxData.trackpointCount,
            distance,
            duration: tcxData?.duration ?? gpxDuration,
            maxSpeed,
            averageHR: tcxData?.averageHR ?? null,
            maxHR: tcxData?.maxHR ?? null,
            calories: tcxData?.calories ?? null,
            startLat: gpxData.startLat ?? tcxData?.startLat ?? null,
            startLon: gpxData.startLon ?? tcxData?.startLon ?? null,
            location: null,
          });
        }
    } catch (err) {
      console.warn(`  Failed to parse ${file}: ${err.message}`);
    }
  }

    console.log(`  Heatmap: ${totalPoints} points across ${Object.keys(heatmapByType).length} types.`);
    fs.writeFileSync(HEATMAP_FILE, JSON.stringify(heatmapByType));
  } else if (newFiles.length > 0) {
    // only new files to process (heatmap already exists) — parse just the new ones
    console.log(`Parsing ${newFiles.length} new GPX files...`);

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const activityId = path.basename(file, ".gpx");
      const gpxPath = path.join(GPX_DIR, file);

      try {
        const gpxData = parseGpxFile(gpxPath);
        if (!gpxData) continue;

        let tcxData = null;
        if (tcxFiles.has(activityId)) {
          try {
            tcxData = parseTcxFile(path.join(TCX_DIR, `${activityId}.tcx`));
          } catch (err) {
            console.warn(`  Failed to parse TCX for ${activityId}: ${err.message}`);
          }
        }

        const distance = gpxData.hasTrack ? computeDistance(gpxData.trackpoints) : (tcxData?.distance ?? 0);
        const gpxDuration = gpxData.hasTrack ? computeDuration(gpxData.trackpoints) : null;
        const maxSpeed = gpxData.hasTrack ? computeMaxSpeed(gpxData.trackpoints) : null;

        activities.push({
          id: activityId,
          name: gpxData.name,
          type: gpxData.type,
          time: gpxData.time,
          hasTrack: gpxData.hasTrack || (tcxData?.hasTrack ?? false),
          trackpointCount: gpxData.trackpointCount,
          distance,
          duration: tcxData?.duration ?? gpxDuration,
          maxSpeed,
          averageHR: tcxData?.averageHR ?? null,
          maxHR: tcxData?.maxHR ?? null,
          calories: tcxData?.calories ?? null,
          startLat: gpxData.startLat ?? tcxData?.startLat ?? null,
          startLon: gpxData.startLon ?? tcxData?.startLon ?? null,
          location: null,
        });
      } catch (err) {
        console.warn(`  Failed to parse ${file}: ${err.message}`);
      }
    }
  } else {
    console.log(`Nothing to do, all activities cached.`);
  }

  // reverse geocode activities that don't have a location yet
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

  // sort by date descending (newest first)
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
