import { getMapStyle } from "./map-style.js";
import { cssVar, formatType } from "./utils.js";

class ClusterMap extends HTMLElement {
  connectedCallback() {
    this._map = null;
    this.style.display = "block";

    if (this._activities) {
      this._render();
    }
  }

  disconnectedCallback() {
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

  _render() {
    const activities = this._activities;
    const withCoords = activities.filter(
      (a) => a.startLat != null && a.startLon != null,
    );

    if (withCoords.length === 0) return;

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
      bounds: [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      fitBoundsOptions: { padding: 30 },
      pitch: 45,
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
}

customElements.define("cluster-map", ClusterMap);
