import { getMapStyle } from "./map-style.js";
import { cssVar } from "./utils.js";

class FeedMap extends HTMLElement {
  static get observedAttributes() {
    return ["activity-id"];
  }

  connectedCallback() {
    this._map = null;
    this._coords = null;
    this.style.display = "block";

    this._observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!this._coords && this._activityId) {
              this._load();
            } else if (this._coords && !this._map) {
              this._render(this._coords);
            }
          } else if (this._map) {
            this._map.remove();
            this._map = null;
          }
        }
      },
      { rootMargin: "200px" },
    );
    this._observer.observe(this);
  }

  disconnectedCallback() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  set activityId(id) {
    this._activityId = id;
  }

  async _load() {
    if (!this._activityId || this._coords) return;

    const res = await fetch(`/api/activities/${this._activityId}/track`);
    if (!res.ok) return;

    const { coords } = await res.json();
    if (!coords || coords.length < 2) return;

    this._coords = coords;
    if (!this._map) {
      this._render(coords);
    }
  }

  _render(coords) {
    const lngLats = coords.map((c) => [c[1], c[0]]);

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const [lng, lat] of lngLats) {
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
      fitBoundsOptions: { padding: 20 },
      interactive: false,
      attributionControl: false,
    });

    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: lngLats },
        },
      });

      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: {
          "line-color": cssVar("--accent"),
          "line-width": 3,
          "line-opacity": 1,
        },
      });
    });

    this._map = map;
  }
}

customElements.define("feed-map", FeedMap);
