import { getMapStyle, MAP_STYLE_CHANGE_EVENT } from "./map-style.js";
import { cssVar, formatType } from "./utils.js";

class ClusterMap extends HTMLElement {
  connectedCallback() {
    this._map = null;
    this.style.display = "block";
    this._onStyleChange = () => this._render();
    window.addEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);

    if (this._activities) {
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

  set activities(data) {
    this._activities = data;

    if (this.isConnected) {
      this._render();
    }
  }

  set showRoutes(value) {
    this._showRoutes = !!value;
  }

  set fitOnUpdate(value) {
    this._fitOnUpdate = !!value;
  }

  _render() {
    const renderId = this._renderId = (this._renderId || 0) + 1;
    const activities = this._activities;
    if (!activities) return;
    const withCoords = activities.filter(
      (a) => a.startLat != null && a.startLon != null,
    );

    if (withCoords.length === 0) {
      this._map?.remove();
      this._map = null;
      return;
    }

    const camera = this._map && !this._fitOnUpdate ? {
      center: this._map.getCenter(),
      zoom: this._map.getZoom(),
      pitch: this._map.getPitch(),
      bearing: this._map.getBearing(),
    } : null;
    if (this._map) {
      this._map.remove();
    }

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const a of withCoords) {
      if (a.startLon < minLng) minLng = a.startLon;
      if (a.startLon > maxLng) maxLng = a.startLon;
      if (a.startLat < minLat) minLat = a.startLat;
      if (a.startLat > maxLat) maxLat = a.startLat;
    }

    const geojson = {
      type: "FeatureCollection",
      features: withCoords.map((a) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [a.startLon, a.startLat] },
        properties: {
          id: a.id,
          name: a.name,
          type: a.type,
          distance: a.distance,
          location: a.location || "",
        },
      })),
    };

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
      scrollZoom: false,
      cooperativeGestures: true,
    });

    map.on("load", () => {
      map.addSource("activities", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "activities",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": cssVar("--accent"),
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 25],
          "circle-opacity": 0.8,
        },
      });

      if (this._showRoutes) this._loadRoutes(map, withCoords, renderId);

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "activities",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Geist"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#000",
        },
      });

      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "activities",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": cssVar("--accent"),
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-stroke-color": cssVar("--accent"),
          "circle-opacity": 0.9,
        },
      });

      map.on("click", "clusters", async (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["clusters"],
        });
        const clusterId = features[0].properties.cluster_id;
        const zoom = await map
          .getSource("activities")
          .getClusterExpansionZoom(clusterId);
        map.easeTo({ center: features[0].geometry.coordinates, zoom });
      });

      map.on("click", "unclustered-point", (e) => {
        const { id, name, type, distance, location } = e.features[0].properties;
        const dist = distance > 0 ? `${(distance / 1000).toFixed(1)} km` : "";
        const html = `<a href="/activity/${id}" style="color:inherit;text-decoration:none"><b>${name}</b><br>${formatType(type)}<br>${dist}${location ? `<br>${location}` : ""}</a>`;

        new maplibregl.Popup()
          .setLngLat(e.features[0].geometry.coordinates)
          .setHTML(html)
          .addTo(map);
      });

      map.on("mouseenter", "clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "clusters", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "unclustered-point", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "unclustered-point", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    this._map = map;
  }

  async _loadRoutes(map, activities, renderId) {
    map.addSource("selected-routes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "selected-routes",
      type: "line",
      source: "selected-routes",
      paint: {
        "line-color": cssVar("--accent"),
        "line-width": 2,
        "line-opacity": 0.65,
      },
    }, "clusters");

    const features = [];
    const latest = [...activities]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 80);
    for (let i = 0; i < latest.length; i += 6) {
      const batch = await Promise.all(latest.slice(i, i + 6).map(async (activity) => {
        try {
          const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/track`);
          if (!response.ok) return null;
          const { coords } = await response.json();
          const line = coords.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
            .map(([lat, lon]) => [lon, lat]);
          if (line.length < 2) return null;
          return { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { id: activity.id } };
        } catch { return null; }
      }));
      if (this._renderId !== renderId || this._map !== map) return;
      features.push(...batch.filter(Boolean));
      map.getSource("selected-routes")?.setData({ type: "FeatureCollection", features });
    }
  }
}

customElements.define("cluster-map", ClusterMap);
