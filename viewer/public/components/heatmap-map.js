import { getMapStyle, MAP_STYLE_CHANGE_EVENT } from "./map-style.js";

const HEATMAP_COLOR_RAMP = [
  "interpolate",
  ["linear"],
  ["heatmap-density"],
  0, "rgba(0,0,255,0)",
  0.1, "rgba(0,0,255,0.4)",
  0.3, "rgba(0,255,255,0.6)",
  0.5, "rgba(0,255,0,0.7)",
  0.7, "rgba(255,255,0,0.8)",
  0.9, "rgba(255,128,0,0.9)",
  1, "rgba(255,0,0,1)",
];

const HEATMAP_RADIUS = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0, 2,
  5, 8,
  10, 15,
  16, 25,
];

const HEATMAP_INTENSITY = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0, 1,
  16, 3,
];

const HEATMAP_OPACITY = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14, 1,
  16, 0,
];

const CIRCLE_COLOR = "#00d230";

class HeatmapMap extends HTMLElement {
  connectedCallback() {
    this._map = null;
    this._requestId ||= 0;
    this.style.display = "block";
    this._canvas = document.createElement('div');
    this._canvas.className = 'heatmap-canvas';
    this._status = document.createElement('div');
    this._status.className = 'heatmap-status';
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');
    this._status.setAttribute('aria-atomic', 'true');
    this._indicator = document.createElement('span');
    this._indicator.className = 'heatmap-loading-indicator';
    this._indicator.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    this._statusTitle = document.createElement('strong');
    this._statusDescription = document.createElement('p');
    this._retry = document.createElement('button');
    this._retry.type = 'button';
    this._retry.textContent = 'Try again';
    this._retry.addEventListener('click', () => this.reload(this._requestedType, this._requestedMode));
    copy.append(this._statusTitle, this._statusDescription, this._retry);
    this._status.append(this._indicator, copy);
    this.replaceChildren(this._canvas, this._status);
    this._onStyleChange = () => {
      if (this._data && !this._fetching) {
        try { this._render(this._data, this._type, this._mode); }
        catch { this._showError(); }
      }
    };
    window.addEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);
    this.reload("", new URLSearchParams(location.search).get("view") === "tracks" ? "tracks" : "heatmap");
  }

  disconnectedCallback() {
    ++this._requestId;
    this._request?.abort();
    window.removeEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  _showStatus(title, description, state = 'loading') {
    this._status.hidden = false;
    this._status.classList.toggle('is-loading', state === 'loading');
    this._statusTitle.textContent = title;
    this._statusDescription.textContent = description;
    this._indicator.hidden = state !== 'loading';
    this._retry.hidden = state !== 'error';
    this._canvas.setAttribute('aria-busy', String(state === 'loading'));
  }

  _showError() {
    const label = this._requestedMode === 'tracks' ? 'Tracks' : 'Heatmap';
    this._showStatus(`${label} could not load`, 'Check your connection and try again.', 'error');
  }

  async reload(type = "", mode = "heatmap") {
    const requestId = ++this._requestId;
    this._request?.abort();
    const request = new AbortController();
    this._request = request;
    this._requestedType = type;
    this._requestedMode = mode;
    this._fetching = true;
    this._showStatus(mode === 'tracks' ? 'Loading tracks…' : 'Loading heatmap…',
      'Fetching your activity locations. Large activity histories can take a little while.');
    const url = mode === "tracks"
      ? "/api/tracks"
      : type ? `/api/heatmap?type=${encodeURIComponent(type)}` : "/api/heatmap";
    try {
      const res = await fetch(url, { signal: request.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId !== this._requestId || !this.isConnected) return;
      this._fetching = false;
      this._render(data, type, mode);
    } catch (err) {
      if (requestId !== this._requestId || !this.isConnected) return;
      this._fetching = false;
      this._showError();
    }
  }

  _render(data, type, mode) {
    this._data = data;
    this._type = type;
    this._mode = mode;
    const requestId = this._requestId;
    this._showStatus(mode === 'tracks' ? 'Drawing tracks…' : 'Drawing heatmap…',
      'Loading map tiles and drawing your activity history.');
    const camera = this._map ? {
      center: this._map.getCenter(),
      zoom: this._map.getZoom(),
      pitch: this._map.getPitch(),
      bearing: this._map.getBearing(),
    } : null;
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
    this._canvas.replaceChildren();

    let bounds = data.bounds;
    if (mode === "heatmap") {
      if (!data.features.length) {
        this._showStatus('No activity locations', 'No GPS data is available for this activity type. Try another filter.', 'empty');
        return;
      }
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const feature of data.features) {
        const [lng, lat] = feature.geometry.coordinates;
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
      bounds = [[minLng, minLat], [maxLng, maxLat]];
    }
    if (!bounds) {
      this._showStatus('No tracks available', 'No GPS tracks are available yet.', 'empty');
      return;
    }

    const map = new maplibregl.Map({
      container: this._canvas,
      style: getMapStyle({ contours: false, terrain: false }),
      ...(camera || { bounds, fitBoundsOptions: { padding: 30 } }),
    });

    map.on("load", () => {
      if (this._map !== map || requestId !== this._requestId) return;
      try {
        if (mode === "tracks") this._addTrackLayers(map, data, type);
        else this._addHeatmapLayers(map, data.features);
        // Source processing and initial tiles finish after the map's load event.
        map.once('idle', () => {
          if (this._map !== map || requestId !== this._requestId || !this.isConnected) return;
          this._canvas.setAttribute('aria-busy', 'false');
          this._status.hidden = true;
        });
      } catch { this._showError(); }
    });

    map.on('error', () => {
      if (this._map === map && requestId === this._requestId && !this._status.hidden) this._showError();
    });

    this._map = map;
  }

  _addTrackLayers(map, data, type) {
    const transitionZoom = data.rasterMaxZoom + 1;
    const query = type ? `&type=${encodeURIComponent(type)}` : "";
    map.addSource("track-raster", {
      type: "raster",
      tiles: [`/api/tracks/raster/{z}/{x}/{y}.png?v=${data.version}${query}`],
      tileSize: 512,
      minzoom: 0,
      maxzoom: data.rasterMaxZoom,
    });
    map.addLayer({
      id: "track-raster-layer",
      type: "raster",
      source: "track-raster",
      maxzoom: transitionZoom,
      paint: { "raster-opacity": 1 },
    });
    map.addSource("track-vector", {
      type: "vector",
      tiles: [`${location.origin}/api/tracks/vector/{z}/{x}/{y}.pbf?v=${data.version}`],
      minzoom: transitionZoom,
      maxzoom: data.vectorMaxZoom,
    });
    map.addLayer({
      id: "track-vector-layer",
      type: "line",
      source: "track-vector",
      "source-layer": "tracks",
      minzoom: transitionZoom,
      ...(type ? { filter: ["==", ["get", "type"], type] } : {}),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": CIRCLE_COLOR,
        "line-width": 4,
        "line-opacity": 0.55,
      },
    });
  }

  _addHeatmapLayers(map, features) {
    map.addSource("heatmap", {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    });

    map.addLayer({
      id: "heatmap-heat",
      type: "heatmap",
      source: "heatmap",
      maxzoom: 16,
      paint: {
        "heatmap-intensity": HEATMAP_INTENSITY,
        "heatmap-color": HEATMAP_COLOR_RAMP,
        "heatmap-radius": HEATMAP_RADIUS,
        "heatmap-opacity": HEATMAP_OPACITY,
      },
    });

    map.addLayer({
      id: "heatmap-point",
      type: "circle",
      source: "heatmap",
      minzoom: 14,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2, 18, 6],
        "circle-color": CIRCLE_COLOR,
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 0.6],
      },
    });
  }
}

customElements.define("heatmap-map", HeatmapMap);
