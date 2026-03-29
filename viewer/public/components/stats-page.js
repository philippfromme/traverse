import { LitElement, html, nothing } from "lit";

import { formatDistance, formatDuration, formatType } from "./utils.js";
import "./cluster-map.js";

class StatsPage extends LitElement {
  static properties = {
    _summary: { state: true },
    _activities: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._summary = null;
    this._activities = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadData();
  }

  async _loadData() {
    const [summaryRes, activitiesRes] = await Promise.all([
      fetch("/api/summary"),
      fetch("/api/activities"),
    ]);
    this._summary = await summaryRes.json();
    const data = await activitiesRes.json();
    this._activities = data.activities;
  }

  updated(changedProperties) {
    if (changedProperties.has("_activities") && this._activities) {
      const map = this.querySelector("cluster-map");
      if (map) map.activities = this._activities;
    }
  }

  render() {
    if (!this._summary) {
      return html`<div class="loading">Loading...</div>`;
    }

    const distKm = Math.round(this._summary.totalDistance / 1000);
    const durH = Math.round(this._summary.totalDuration / 3600);

    const types = Object.entries(this._summary.byType).sort(
      (a, b) => b[1].distance - a[1].distance,
    );

    return html`
      <div class="summary-totals">
        <div class="stat-card summary-hero">
          <div class="stat-value">
            ${this._summary.totalCount.toLocaleString()}
          </div>
          <div class="stat-label">Activities</div>
        </div>
        <div class="stat-card summary-hero">
          <div class="stat-value">${distKm.toLocaleString()}</div>
          <div class="stat-label">Kilometers</div>
        </div>
        <div class="stat-card summary-hero">
          <div class="stat-value">${durH.toLocaleString()}</div>
          <div class="stat-label">Hours</div>
        </div>
      </div>

      <cluster-map class="cluster-map-container"></cluster-map>

      <div class="table-group">
        <div class="table-header stats-table-header">
          <span>Type</span>
          <span>Count</span>
          <span>Distance</span>
          <span>Duration</span>
        </div>
        <div class="activity-list">
          ${types.map(
            ([type, s]) => html`
              <a href="/stats/${encodeURIComponent(type)}" class="activity-row">
                <span class="col-type">${formatType(type)}</span>
                <span class="col-name">${s.count} activities</span>
                <span class="col-distance"
                  >${s.distance > 0 ? formatDistance(s.distance) : ""}</span
                >
                <span class="col-duration"
                  >${s.duration > 0 ? formatDuration(s.duration) : ""}</span
                >
              </a>
            `,
          )}
        </div>
      </div>
    `;
  }
}

customElements.define("stats-page", StatsPage);
