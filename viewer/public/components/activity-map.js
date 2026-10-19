import { getMapStyle, MAP_STYLE_CHANGE_EVENT } from "./map-style.js";
import { cssVar } from "./utils.js";

class ActivityMap extends HTMLElement {
  connectedCallback() {
    this._map = null;
    this.style.display = "block";
    this._onStyleChange = () => this._render();
    window.addEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);

    if (this._trackpoints) {
      this._render();
    }
  }

  disconnectedCallback() {
    window.removeEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  set trackpoints(pts) {
    this._trackpoints = pts;

    if (this.isConnected) {
      this._render();
    }
  }

  _render() {
    const trackpoints = this._trackpoints;

    if (!trackpoints || trackpoints.length === 0) return;

    const camera = this._map ? {
      center: this._map.getCenter(),
      zoom: this._map.getZoom(),
      pitch: this._map.getPitch(),
      bearing: this._map.getBearing(),
    } : null;
    if (this._map) {
      this._map.remove();
    }

    const coords = trackpoints.map((pt) => [pt.lon, pt.lat]);

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    const map = new maplibregl.Map({
      container: this,
      style: getMapStyle(),
      ...(camera || {
        bounds: [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        fitBoundsOptions: { padding: 30 },
        pitch: 45,
      }),
      maxPitch: 85,
      cooperativeGestures: true,
    });

    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
        },
      });

      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: {
          "line-color": cssVar("--accent"),
          "line-width": 4,
          "line-opacity": 1,
        },
      });

      if (coords.length > 0) {
        map.addSource("markers", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: coords[0] },
                properties: { type: "start" },
              },
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: coords[coords.length - 1],
                },
                properties: { type: "end" },
              },
            ],
          },
        });

        map.addLayer({
          id: "start-marker",
          type: "circle",
          source: "markers",
          filter: ["==", ["get", "type"], "start"],
          paint: {
            "circle-radius": 6,
            "circle-color": cssVar("--accent"),
            "circle-stroke-width": 2,
            "circle-stroke-color": cssVar("--accent"),
          },
        });

        map.addLayer({
          id: "end-marker",
          type: "circle",
          source: "markers",
          filter: ["==", ["get", "type"], "end"],
          paint: {
            "circle-radius": 6,
            "circle-color": cssVar("--accent"),
            "circle-stroke-width": 2,
            "circle-stroke-color": cssVar("--accent"),
          },
        });

        map.on("click", "start-marker", (e) => {
          new maplibregl.Popup()
            .setLngLat(e.features[0].geometry.coordinates)
            .setText("Start")
            .addTo(map);
        });

        map.on("click", "end-marker", (e) => {
          new maplibregl.Popup()
            .setLngLat(e.features[0].geometry.coordinates)
            .setText("End")
            .addTo(map);
        });
      }
    });

    this._map = map;
  }
}

customElements.define("activity-map", ActivityMap);
