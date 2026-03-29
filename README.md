# Traverse

Your GPX activities on a self-hosted viewer. Fetches activities from Garmin Connect, indexes them with reverse geocoding, and serves a fast, searchable UI with maps and stats.

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
npm run fetch-gpx:garmin
```

Opens a browser to log in to Garmin Connect and downloads all GPX files to `gpx/`. Use `npm run fetch-gpx:headed` to see the browser.

### Build the index

```
npm run build-index
```

Parses all GPX files and reverse geocodes activity locations via OpenStreetMap Nominatim. Results are cached — only new activities get geocoded on subsequent runs.

### Start the viewer

```
npm start
```

Opens `http://localhost:3000` with:

- Searchable, filterable activity list
- Activity detail pages with map and stats
- Stats overview with world map (clustered) and per-type breakdowns with charts

## Project Structure

```
scripts/          Utility scripts
  fetch-garmin.js   Fetch GPX files from Garmin Connect
  build-index.js    Parse GPX files and build activity index
viewer/           Web viewer
  server.js         Express server and API
  public/           Frontend (HTML, CSS, JS)
gpx/              GPX files (gitignored)
```
