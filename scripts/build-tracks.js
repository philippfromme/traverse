import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { XMLParser } from "fast-xml-parser";
import FitParser from "fit-file-parser";
import GeoJSONVT from "geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import sharp from "sharp";
import { gzipSync } from "zlib";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || "./cache");
const ROOT = path.join(CACHE_DIR, "track-tiles");
const INDEX_FILE = path.join(CACHE_DIR, "activity-index.json");
const MANIFEST_FILE = path.join(ROOT, "manifest.json");
const SCRIPT_VERSION = 4;
const RASTER_MAX_ZOOM = 7;
const VECTOR_MAX_ZOOM = 12;
const TILE_SIZE = 512;

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const fitParser = new FitParser({ force: true, mode: "cascade" });

const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const valid = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) &&
  lon >= -180 && lon <= 180 && lat >= -85.051129 && lat <= 85.051129;

function addPoint(segment, lon, lat) {
  if (!valid(lon, lat)) return;
  const last = segment.at(-1);
  if (!last || last[0] !== lon || last[1] !== lat) segment.push([lon, lat]);
}

function xmlSegments(file, source) {
  const document = xmlParser.parse(fs.readFileSync(file, "utf8"));
  const segments = [];
  if (source === "gpx") {
    for (const track of asArray(document.gpx?.trk)) {
      for (const section of asArray(track.trkseg)) {
        const points = [];
        for (const point of asArray(section.trkpt)) {
          addPoint(points, Number(point["@_lon"]), Number(point["@_lat"]));
        }
        if (points.length >= 2) segments.push(points);
      }
    }
  } else {
    for (const activity of asArray(document.TrainingCenterDatabase?.Activities?.Activity)) {
      for (const lap of asArray(activity.Lap)) {
        for (const track of asArray(lap.Track)) {
          const points = [];
          for (const point of asArray(track.Trackpoint)) {
            if (point.Position?.LongitudeDegrees == null || point.Position?.LatitudeDegrees == null) continue;
            addPoint(points, Number(point.Position.LongitudeDegrees), Number(point.Position.LatitudeDegrees));
          }
          if (points.length >= 2) segments.push(points);
        }
      }
    }
  }
  return segments;
}

async function fitSegments(file) {
  const buffer = await fs.promises.readFile(file);
  const data = await new Promise((resolve, reject) => fitParser.parse(buffer, (err, result) =>
    err ? reject(err) : resolve(result)));
  const segments = [];
  for (const session of asArray(data?.activity?.sessions)) {
    for (const lap of asArray(session.laps)) {
      const points = [];
      for (const record of asArray(lap.records)) {
        if (record.position_lat != null && record.position_long != null) {
          addPoint(points, Number(record.position_long), Number(record.position_lat));
        }
      }
      if (points.length >= 2) segments.push(points);
    }
  }
  return segments;
}

function safeKey(activity) {
  return Buffer.from(`${activity.source}:${activity.id}`).toString("base64url");
}

function sourcePath(activity) {
  return path.join(DATA_DIR, activity.source, `${activity.id}.${activity.source}`);
}

async function writeRaster(file, paths, zoom) {
  if (!paths.length) return false;
  const strokeWidth = Math.max(0.75, 4 / 2 ** (RASTER_MAX_ZOOM + 1 - zoom));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}"><g fill="none" stroke="#00d230" stroke-opacity="0.48" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths.map((path) => `<path d="${path}"/>`).join("")}</g></svg>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg), { limitInputPixels: false }).png({ compressionLevel: 7 }).toFile(file);
  return true;
}

function project(lon, lat, scale) {
  const radians = lat * Math.PI / 180;
  return [
    (lon + 180) / 360 * scale,
    (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale,
  ];
}

async function buildRasterTiles(features, output) {
  let count = 0;
  for (let z = 0; z <= RASTER_MAX_ZOOM; z++) {
    const tileCount = 2 ** z;
    const scale = tileCount * TILE_SIZE;
    const tiles = new Map();
    for (const feature of features) {
      for (const segment of feature.geometry.coordinates) {
        const projected = segment.map(([lon, lat]) => project(lon, lat, scale));
        const kept = [projected[0]];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const point of projected) {
          minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
          minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
          const last = kept.at(-1);
          if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= 0.7) kept.push(point);
        }
        const final = projected.at(-1);
        if (kept.at(-1) !== final) kept.push(final);
        // A route smaller than a pixel is still drawn as a short stroke.
        if (kept.length < 2 || kept.every(([x, y]) => x === kept[0][0] && y === kept[0][1])) {
          kept.push([kept[0][0] + 0.01, kept[0][1]]);
        }
        const firstX = Math.max(0, Math.floor((minX - 1) / TILE_SIZE));
        const lastX = Math.min(tileCount - 1, Math.floor((maxX + 1) / TILE_SIZE));
        const firstY = Math.max(0, Math.floor((minY - 1) / TILE_SIZE));
        const lastY = Math.min(tileCount - 1, Math.floor((maxY + 1) / TILE_SIZE));
        for (let x = firstX; x <= lastX; x++) {
          for (let y = firstY; y <= lastY; y++) {
            const key = `${x}/${y}`;
            if (!tiles.has(key)) tiles.set(key, new Map());
            const groups = tiles.get(key);
            const type = feature.properties.type;
            if (!groups.has(type)) groups.set(type, []);
            groups.get(type).push(kept.map(([px, py], i) =>
              `${i ? "L" : "M"}${(px - x * TILE_SIZE).toFixed(2)} ${(py - y * TILE_SIZE).toFixed(2)}`).join(" "));
          }
        }
      }
    }
    for (const [key, groups] of tiles) {
      const base = path.join(output, "raster");
      const allPaths = [...groups.values()].flat();
      await writeRaster(path.join(base, "all", `${z}`, `${key}.png`), allPaths, z);
      count++;
      for (const [type, paths] of groups) {
        const slug = Buffer.from(type).toString("base64url");
        await writeRaster(path.join(base, slug, `${z}`, `${key}.png`), paths, z);
      }
    }
    console.log(`  Raster zoom ${z}: ${tiles.size} occupied tiles.`);
  }
  return count;
}

export async function buildTrackTiles({ force = false } = {}) {
  const activities = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const entries = activities.filter((activity) => activity.hasTrack &&
    ["fit", "gpx", "tcx"].includes(activity.source));
  const signatures = {};
  for (const activity of entries) {
    const stat = fs.statSync(sourcePath(activity));
    signatures[safeKey(activity)] = `${stat.size}:${stat.mtimeMs}:${activity.type}`;
  }

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")); } catch {}
  if (!force && previous?.scriptVersion === SCRIPT_VERSION &&
    JSON.stringify(previous.signatures) === JSON.stringify(signatures)) {
    console.log("Track tiles up to date.");
    return previous;
  }

  fs.mkdirSync(ROOT, { recursive: true });
  const routeCache = path.join(ROOT, "routes");
  fs.mkdirSync(routeCache, { recursive: true });
  const features = [];
  const types = new Set();
  let pointCount = 0;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  console.log(`Building track tiles from ${entries.length} GPS activities...`);
  for (let i = 0; i < entries.length; i++) {
    const activity = entries[i];
    const key = safeKey(activity);
    const cacheFile = path.join(routeCache, `${key}.json`);
    let route;
    if (!force && previous?.signatures?.[key] === signatures[key] && fs.existsSync(cacheFile)) {
      route = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } else {
      try {
        const segments = activity.source === "fit"
          ? await fitSegments(sourcePath(activity))
          : xmlSegments(sourcePath(activity), activity.source);
        route = { id: activity.id, type: activity.type || "unknown", segments };
        fs.writeFileSync(cacheFile, JSON.stringify(route));
      } catch (err) {
        console.warn(`  Track ${activity.id}: ${err.message}`);
        continue;
      }
    }
    if (!route.segments.length) continue;
    types.add(route.type);
    for (const segment of route.segments) {
      pointCount += segment.length;
      for (const [lon, lat] of segment) {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
    }
    features.push({
      type: "Feature",
      properties: { id: route.id, type: route.type },
      geometry: { type: "MultiLineString", coordinates: route.segments },
    });
    if ((i + 1) % 250 === 0) console.log(`  Routes: ${i + 1}/${entries.length}`);
  }

  const version = `${Date.now()}`;
  const output = path.join(ROOT, version);
  fs.mkdirSync(output, { recursive: true });
  const index = new GeoJSONVT({ type: "FeatureCollection", features }, {
    maxZoom: VECTOR_MAX_ZOOM,
    indexMaxZoom: VECTOR_MAX_ZOOM,
    indexMaxPoints: 0,
    tolerance: 0.5,
    buffer: 64,
  });
  console.log(`  Compiling ${index.tileCoords.length} occupied tiles...`);
  const rasterCount = await buildRasterTiles(features, output);
  let vectorCount = 0;
  for (const { z, x, y } of index.tileCoords) {
    if (z <= RASTER_MAX_ZOOM) continue;
    const tile = index.getTile(z, x, y);
    if (!tile?.features.length) continue;
    const file = path.join(output, "vector", `${z}`, `${x}`, `${y}.pbf.gz`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, gzipSync(fromGeojsonVt({ tracks: tile })));
    vectorCount++;
  }

  const manifest = {
    scriptVersion: SCRIPT_VERSION,
    version,
    bounds: Number.isFinite(minLon) ? [[minLon, minLat], [maxLon, maxLat]] : null,
    activityCount: features.length,
    pointCount,
    types: [...types].sort(),
    rasterMaxZoom: RASTER_MAX_ZOOM,
    vectorMaxZoom: VECTOR_MAX_ZOOM,
    signatures,
  };
  const temp = `${MANIFEST_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(manifest));
  fs.renameSync(temp, MANIFEST_FILE);
  for (const name of fs.readdirSync(ROOT)) {
    if (!/^\d+$/.test(name) || name === version || name === previous?.version) continue;
    const old = path.resolve(ROOT, name);
    if (old.startsWith(`${path.resolve(ROOT)}${path.sep}`)) {
      try { fs.rmSync(old, { recursive: true, force: true }); }
      catch (err) { console.warn(`  Could not remove old track tiles ${name}: ${err.message}`); }
    }
  }
  for (const name of fs.readdirSync(routeCache)) {
    if (!name.endsWith(".json") || signatures[name.slice(0, -5)]) continue;
    fs.unlinkSync(path.join(routeCache, name));
  }
  console.log(`  Track tiles: ${rasterCount} raster and ${vectorCount} vector, ${pointCount} points.`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildTrackTiles({ force: process.argv.includes("--force") }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
