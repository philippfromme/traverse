# Traverse

Your Garmin activities in a self-hosted viewer. Fetches activity data from Garmin Connect, indexes it with reverse geocoding, and serves a fast, searchable UI with maps and stats.

![](docs/activities.png)
![](docs/activity.png)
![](docs/stats.png)
![](docs/stat.png)

## Setup

```
npm install
```

Create a `.env` file (see `.env.example`) with your Garmin credentials if using auto-login.

## Usage

### Fetch activities from Garmin

```
npm run fetch-garmin
```

Opens a browser to log in to Garmin Connect and downloads:

- GPX files to `gpx/` (track geometry and activity basics)
- TCX files to `tcx/` (detailed metrics like HR/duration/calories when available)

Use `npm run fetch-garmin:headed` to run with a visible browser.

### Build the index

```
npm run build-index
```

Builds generated artifacts:

- `activity-index.json` (activity index for the viewer)
- `heatmap-data.json` (precomputed heatmap points by activity type)

During indexing:

- GPX is used for route/track points and heatmap generation.
- Duration/HR/calories are taken from TCX when available.
- GPX-derived timing is used as a fallback when TCX data is missing.

Activity locations are reverse geocoded via OpenStreetMap Nominatim. Results are cached, so only new activities get geocoded on subsequent runs.

### Start the viewer

```
npm start
```

Opens `http://localhost:3000` with:

- Searchable, filterable activity list
- Activity detail pages with map and stats
- Stats overview with world map (clustered) and per-type breakdowns with charts

## Docker

A Docker image is published to GitHub Container Registry when a version tag is pushed (e.g., `git tag v1.0.0 && git push --tags`).

### Pull and run

```
docker run -d \
  -p 3000:3000 \
  -v /data/traverse:/app/data \
  ghcr.io/philippfromme/traverse:latest
```

Your data directory should contain:

```
/data/traverse/
  gpx/                  GPX files (your backup)
  tcx/                  TCX files (your backup)
  activity-index.json   Generated on first start (persisted automatically)
  heatmap-data.json     Generated on first start (persisted automatically)
```

The server builds `activity-index.json` and `heatmap-data.json` automatically on first start if they don't exist. On subsequent starts, only new activities are processed.

### Build locally

```
docker build -t traverse .
docker run -d -p 3000:3000 -v /path/to/data:/app/data traverse
```

## Project Structure

```
scripts/          Utility scripts
  fetch-garmin.js   Fetch Garmin metadata plus GPX/TCX exports
  build-index.js    Build index + heatmap from GPX with TCX enrichment
viewer/           Web viewer
  server.js         Express server and API
  public/           Frontend (HTML, CSS, JS)
gpx/              GPX files (gitignored)
tcx/              TCX files (gitignored)
activity-index.json Generated activity index (gitignored)
heatmap-data.json  Generated heatmap data (gitignored)
```
