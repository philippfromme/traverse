import { LitElement, html, nothing } from "lit";

import {
  formatDate,
  formatType,
  formatDuration,
  formatDurationLong,
} from "./utils.js";
import "./activity-map.js";
import "./elevation-chart.js";
import "./heart-rate-chart.js";

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeStats(trackpoints) {
  if (trackpoints.length === 0) return null;

  let totalDistance = 0;
  let elevationGain = 0;
  let maxEle = -Infinity;
  let minEle = Infinity;
  const heartRates = [];

  for (let i = 0; i < trackpoints.length; i++) {
    const pt = trackpoints[i];

    if (i > 0) {
      const prev = trackpoints[i - 1];
      totalDistance += haversineDistance(prev.lat, prev.lon, pt.lat, pt.lon);

      if (pt.ele != null && prev.ele != null) {
        const diff = pt.ele - prev.ele;
        if (diff > 0) elevationGain += diff;
      }
    }

    if (pt.ele != null) {
      if (pt.ele > maxEle) maxEle = pt.ele;
      if (pt.ele < minEle) minEle = pt.ele;
    }

    if (pt.hr != null) {
      heartRates.push(pt.hr);
    }
  }

  const first = trackpoints[0];
  const last = trackpoints[trackpoints.length - 1];
  let duration = null;

  if (first.time && last.time) {
    duration = (new Date(last.time) - new Date(first.time)) / 1000;
  }

  const avgHr =
    heartRates.length > 0
      ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length)
      : null;
  const maxHr = heartRates.length > 0 ? Math.max(...heartRates) : null;

  return {
    distance: totalDistance,
    duration,
    elevationGain: Math.round(elevationGain),
    maxElevation: maxEle === -Infinity ? null : Math.round(maxEle),
    minElevation: minEle === Infinity ? null : Math.round(minEle),
    avgHr,
    maxHr,
    trackpointCount: trackpoints.length,
  };
}

class ActivityDetailPage extends LitElement {
  static properties = {
    _activity: { state: true },
    _stats: { state: true },
    _error: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._activity = null;
    this._stats = null;
    this._error = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadActivity();
  }

  async _loadActivity() {
    const pathParts = window.location.pathname.split("/");
    const activityId = pathParts[pathParts.length - 1];

    const res = await fetch(`/api/activities/${activityId}`);

    if (!res.ok) {
      this._error = true;
      return;
    }

    this._activity = await res.json();
    this._stats = computeStats(this._activity.trackpoints);
    document.title = this._activity.name;
  }

  updated(changedProperties) {
    if (changedProperties.has("_activity") && this._activity?.hasTrack) {
      const map = this.querySelector("activity-map");
      if (map) {
        map.trackpoints = this._activity.trackpoints;
      }

      const elevChart = this.querySelector("elevation-chart");
      if (elevChart) {
        const trackpoints = this._activity.trackpoints;
        const hasElevation = trackpoints.some((pt) => pt.ele != null);
        if (hasElevation) {
          const distances = [];
          const elevations = [];
          let cumDist = 0;
          for (let i = 0; i < trackpoints.length; i++) {
            if (trackpoints[i].ele == null) continue;
            if (i > 0) {
              const prev = trackpoints[i - 1];
              cumDist += haversineDistance(
                prev.lat,
                prev.lon,
                trackpoints[i].lat,
                trackpoints[i].lon,
              );
            }
            distances.push(cumDist);
            elevations.push(trackpoints[i].ele);
          }
          elevChart.data = { distances, elevations };
        }
      }

      const hrChart = this.querySelector("heart-rate-chart");
      if (hrChart) {
        const trackpoints = this._activity.trackpoints;
        const hasHr = trackpoints.some((pt) => pt.hr != null);
        if (hasHr) {
          const distances = [];
          const heartRates = [];
          let cumDist = 0;
          for (let i = 0; i < trackpoints.length; i++) {
            if (trackpoints[i].hr == null) continue;
            if (i > 0) {
              const prev = trackpoints[i - 1];
              cumDist += haversineDistance(
                prev.lat,
                prev.lon,
                trackpoints[i].lat,
                trackpoints[i].lon,
              );
            }
            distances.push(cumDist);
            heartRates.push(trackpoints[i].hr);
          }
          hrChart.data = { distances, heartRates };
        }
      }
    }
  }

  _hasElevation() {
    return this._activity?.trackpoints?.some((pt) => pt.ele != null) ?? false;
  }

  _hasHeartRate() {
    return this._activity?.trackpoints?.some((pt) => pt.hr != null) ?? false;
  }

  _renderStats() {
    const stats = this._stats;
    if (!stats) return nothing;

    const items = [];

    if (stats.distance > 0) {
      const km = (stats.distance / 1000).toFixed(2);
      items.push({ label: "Distance", value: `${km} km` });
    }

    if (stats.duration != null) {
      items.push({ label: "Duration", value: formatDuration(stats.duration) });
    }

    if (stats.distance > 0 && stats.duration > 0) {
      const paceSecPerKm = stats.duration / (stats.distance / 1000);
      const paceMin = Math.floor(paceSecPerKm / 60);
      const paceSec = Math.floor(paceSecPerKm % 60);
      items.push({
        label: "Avg Pace",
        value: `${paceMin}:${paceSec.toString().padStart(2, "0")} /km`,
      });

      const speedKmh = (
        stats.distance /
        1000 /
        (stats.duration / 3600)
      ).toFixed(1);
      items.push({ label: "Avg Speed", value: `${speedKmh} km/h` });
    }

    if (this._activity?.maxSpeed) {
      const maxSpeedKmh = (this._activity.maxSpeed * 3.6).toFixed(1);
      items.push({ label: "Max Speed", value: `${maxSpeedKmh} km/h` });
    }

    if (stats.elevationGain > 0) {
      items.push({
        label: "Elevation Gain",
        value: `${stats.elevationGain} m`,
      });
    }

    if (stats.minElevation != null && stats.maxElevation != null) {
      items.push({
        label: "Elevation Range",
        value: `${stats.minElevation} – ${stats.maxElevation} m`,
      });
    }

    if (stats.avgHr) {
      items.push({ label: "Avg Heart Rate", value: `${stats.avgHr} bpm` });
    }

    if (stats.maxHr) {
      items.push({ label: "Max Heart Rate", value: `${stats.maxHr} bpm` });
    }

    items.push({
      label: "Trackpoints",
      value: stats.trackpointCount.toLocaleString(),
    });

    return html`
      <div class="stats-grid">
        ${items.map(
          (s) => html`
            <div class="stat-card">
              <div class="stat-label">${s.label}</div>
              <div class="stat-value">${s.value}</div>
            </div>
          `,
        )}
      </div>
    `;
  }

  render() {
    if (this._error) {
      return html`<div class="loading">Activity not found.</div>`;
    }

    if (!this._activity) {
      return html`<div class="loading">Loading...</div>`;
    }

    const activity = this._activity;
    const stats = this._stats;

    const dist =
      stats && stats.distance > 0
        ? stats.distance >= 1000
          ? `${(stats.distance / 1000).toFixed(1)} km`
          : `${Math.round(stats.distance)} m`
        : "";
    const dur =
      stats && stats.duration > 0 ? formatDurationLong(stats.duration) : "";

    return html`
      <div class="detail-header">
        <h2>${activity.name}</h2>
        <div class="detail-meta">
          <span>${formatType(activity.type)}</span>
          <span>${formatDate(activity.time)}</span>
          ${activity.location
            ? html`<span>${activity.location}</span>`
            : nothing}
          ${dist ? html`<span>${dist}</span>` : nothing}
          ${dur ? html`<span>${dur}</span>` : nothing}
        </div>
      </div>
      ${activity.hasTrack
        ? html`<activity-map class="map-container"></activity-map>`
        : html`<div class="no-gps">No GPS data for this activity</div>`}
      ${this._hasElevation()
        ? html`<div class="chart-section">
            <div class="chart-header">Elevation</div>
            <elevation-chart class="chart-canvas"></elevation-chart>
          </div>`
        : nothing}
      ${this._hasHeartRate()
        ? html`<div class="chart-section">
            <div class="chart-header">Heart Rate</div>
            <heart-rate-chart class="chart-canvas"></heart-rate-chart>
          </div>`
        : nothing}
      ${this._renderStats()}
    `;
  }
}

customElements.define("activity-detail-page", ActivityDetailPage);
