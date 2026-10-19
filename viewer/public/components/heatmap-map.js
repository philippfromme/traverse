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
    this._requestId = 0;
    this.style.display = "block";
    this._onStyleChange = () => {
      if (this._data) this._render(this._data, this._type, this._mode);
    };
    window.addEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);
    this.reload("", new URLSearchParams(location.search).get("view") === "tracks" ? "tracks" : "heatmap");
  }

  disconnectedCallback() {
    window.removeEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  async reload(type = "", mode = "heatmap") {
    const requestId = ++this._requestId;
    const url = mode === "tracks"
      ? "/api/tracks"
      : type ? `/api/heatmap?type=${encodeURIComponent(type)}` : "/api/heatmap";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId !== this._requestId || !this.isConnected) return;
      this._render(data, type, mode);
    } catch (err) {
      if (requestId !== this._requestId || !this.isConnected) return;
      if (this._map) this._map.remove();
      this._map = null;
      this.replaceChildren();
      const message = document.createElement("div");
      message.className = "heatmap-error";
      message.textContent = mode === "tracks"
        ? `Tracks could not load (${err.message}). Restart the viewer and try again.`
        : `Heatmap could not load (${err.message}).`;
      this.append(message);
    }
  }

  _render(data, type, mode) {
    this._data = data;
    this._type = type;
    this._mode = mode;
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
    this.replaceChildren();

    let bounds = data.bounds;
    if (mode === "heatmap") {
      if (!data.features.length) return;
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const feature of data.features) {
        const [lng, lat] = feature.geometry.coordinates;
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
      bounds = [[minLng, minLat], [maxLng, maxLat]];
    }
    if (!bounds && !camera) return;

    const map = new maplibregl.Map({
      container: this,
      style: getMapStyle({ contours: false, terrain: false }),
      ...(camera || { bounds, fitBoundsOptions: { padding: 30 } }),
    });

    map.on("load", () => {
      if (mode === "tracks") {
        this._addTrackLayers(map, data, type);
      } else {
        this._addHeatmapLayers(map, data.features);
      }
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
