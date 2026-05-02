import { getMapStyle } from "./map-style.js";

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
    this.style.display = "block";
    this._load();
  }

  disconnectedCallback() {
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  async _load(type) {
    const url = type ? `/api/heatmap?type=${encodeURIComponent(type)}` : "/api/heatmap";
    const res = await fetch(url);
    if (!res.ok) return;

    const data = await res.json();
    this._render(data);
  }

  _render(data) {
    if (this._map) {
      this._map.remove();
    }

    const features = data.features;
    if (!features.length) return;

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    const map = new maplibregl.Map({
      container: this,
      style: getMapStyle({ contours: false, terrain: false }),
      bounds: [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      fitBoundsOptions: { padding: 30 },
    });

    map.on("load", () => {
      map.addSource("heatmap", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features,
        },
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
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14, 2,
            18, 6,
          ],
          "circle-color": CIRCLE_COLOR,
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14, 0,
            15, 0.6,
          ],
        },
      });
    });

    this._map = map;
  }

  reload(type) {
    this._load(type);
  }
}

customElements.define("heatmap-map", HeatmapMap);
