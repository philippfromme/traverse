let _demSource = null;

export function getDemSource() {
  if (!_demSource) {
    _demSource = new mlcontour.DemSource({
      url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      encoding: "terrarium",
      maxzoom: 15,
      worker: true,
    });
    _demSource.setupMaplibre(maplibregl);
  }
  return _demSource;
}

export function getMapStyle({ contours = true, terrain = true } = {}) {
  const demSource = getDemSource();

  const sources = {
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  };

  if (terrain) {
    sources.terrainSource = {
      type: "raster-dem",
      tiles: [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      ],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
    };
  }

  const layers = [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#0b0b0d",
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: {
        "fill-color": "#022611",
      },
    },
    {
      id: "landuse-park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["in", "class", "park", "cemetery", "grass"],
      paint: {
        "fill-color": "#0b0b0d",
      },
    },
    {
      id: "road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["all", ["in", "class", "minor", "service", "track", "path"]],
      paint: {
        "line-color": "#1a1a1f",
        "line-width": 0.5,
      },
      minzoom: 13,
    },
    {
      id: "road-secondary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "secondary", "tertiary"],
      paint: {
        "line-color": "#1e1e24",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2],
      },
      minzoom: 9,
    },
    {
      id: "road-primary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "primary", "trunk"],
      paint: {
        "line-color": "#252530",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 14, 3],
      },
      minzoom: 7,
    },
    {
      id: "road-motorway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["==", "class", "motorway"],
      paint: {
        "line-color": "#2a2a35",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 14, 4],
      },
      minzoom: 5,
    },
  ];

  if (contours) {
    sources.contourSource = {
      type: "vector",
      tiles: [
        demSource.contourProtocolUrl({
          multiplier: 1,
          overzoom: 1,
          thresholds: {
            11: [100, 500],
            12: [50, 200],
            13: [50, 200],
            14: [20, 100],
            15: [10, 50],
          },
          elevationKey: "ele",
          levelKey: "level",
          contourLayer: "contours",
        }),
      ],
      maxzoom: 15,
    };

    layers.push(
      {
        id: "contours",
        type: "line",
        source: "contourSource",
        "source-layer": "contours",
        paint: {
          "line-opacity": ["match", ["get", "level"], 1, 0.3, 0.15],
          "line-width": ["match", ["get", "level"], 1, 1, 0.5],
          "line-color": "#414141",
        },
      },
      {
        id: "contour-text",
        type: "symbol",
        source: "contourSource",
        "source-layer": "contours",
        filter: [">", ["get", "level"], 0],
        paint: {
          "text-halo-color": "#0b0b0d",
          "text-halo-width": 2,
          "text-color": "#6d6d6d",
        },
        layout: {
          "symbol-placement": "line",
          "text-size": 10,
          "text-field": ["concat", ["number-format", ["get", "ele"], {}], "m"],
          "text-font": ["Geist"],
        },
      },
    );
  }

  // Place labels go on top of everything
  layers.push(
    {
      id: "place-city",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["==", "class", "city"],
      layout: {
        "text-field": "{name}",
        "text-font": ["Geist"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 12, 10, 18],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.1,
      },
      paint: {
        "text-color": "#6d6d6d",
        "text-halo-color": "#0b0b0d",
        "text-halo-width": 2,
      },
      minzoom: 4,
    },
    {
      id: "place-town",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["==", "class", "town"],
      layout: {
        "text-field": "{name}",
        "text-font": ["Geist"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 14],
      },
      paint: {
        "text-color": "#555555",
        "text-halo-color": "#0b0b0d",
        "text-halo-width": 2,
      },
      minzoom: 8,
    },
    {
      id: "place-village",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["in", "class", "village", "suburb", "neighbourhood"],
      layout: {
        "text-field": "{name}",
        "text-font": ["Geist"],
        "text-size": 11,
      },
      paint: {
        "text-color": "#444444",
        "text-halo-color": "#0b0b0d",
        "text-halo-width": 2,
      },
      minzoom: 11,
    },
  );

  const style = {
    version: 8,
    sources,
    layers,
  };

  if (terrain) {
    style.terrain = {
      source: "terrainSource",
      exaggeration: 1,
    };
  }

  return style;
}
