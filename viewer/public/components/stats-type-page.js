import { LitElement, html, nothing } from "lit";

import { formatDistance, formatDuration, formatType } from "./utils.js";
import "./cluster-map.js";
import "./area-chart.js";

function formatMonthLabel(dateStr) {
  const d = new Date(dateStr);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getMonthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function generateMonthRange(activities) {
  if (activities.length === 0) return [];
  const dates = activities
    .filter((a) => a.time)
    .map((a) => new Date(a.time))
    .sort((a, b) => a - b);
  if (dates.length === 0) return [];

  const start = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
  const end = new Date(
    dates[dates.length - 1].getFullYear(),
    dates[dates.length - 1].getMonth(),
    1,
  );

  const months = [];
  const cur = new Date(start);
  while (cur <= end) {
    months.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`,
    );
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function computeMonthlyData(activities) {
  const months = generateMonthRange(activities);
  const distByMonth = {};
  const durByMonth = {};
  const countByMonth = {};

  for (const m of months) {
    distByMonth[m] = 0;
    durByMonth[m] = 0;
    countByMonth[m] = 0;
  }

  for (const a of activities) {
    if (!a.time) continue;
    const key = getMonthKey(a.time);
    distByMonth[key] = (distByMonth[key] || 0) + (a.distance || 0);
    durByMonth[key] = (durByMonth[key] || 0) + (a.duration || 0);
    countByMonth[key] = (countByMonth[key] || 0) + 1;
  }

  const monthLabels = months.map((m) => {
    const [y, mo] = m.split("-");
    return formatMonthLabel(`${y}-${mo}-01`);
  });

  return {
    monthLabels,
    distValues: months.map((m) => distByMonth[m] / 1000),
    durValues: months.map((m) => durByMonth[m]),
    countValues: months.map((m) => countByMonth[m]),
  };
}

class StatsTypePage extends LitElement {
  static properties = {
    _activities: { state: true },
    _type: { state: true },
    _monthlyData: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._activities = null;
    this._type = "";
    this._monthlyData = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadData();
  }

  async _loadData() {
    const pathParts = window.location.pathname.split("/");
    this._type = decodeURIComponent(pathParts[pathParts.length - 1]);
    document.title = `Traverse — ${formatType(this._type)}`;

    const res = await fetch(
      `/api/activities?type=${encodeURIComponent(this._type)}`,
    );
    const data = await res.json();
    this._activities = data.activities;

    if (this._activities.length > 0) {
      this._monthlyData = computeMonthlyData(this._activities);
    }
  }

  updated(changedProperties) {
    if (changedProperties.has("_activities") && this._activities?.length) {
      const map = this.querySelector("cluster-map");
      if (map) map.activities = this._activities;
    }

    if (changedProperties.has("_monthlyData") && this._monthlyData) {
      const { monthLabels, distValues, durValues, countValues } =
        this._monthlyData;

      const distChart = this.querySelector("#chart-distance");
      if (distChart)
        distChart.data = {
          labels: monthLabels,
          values: distValues,
          unit: "km",
        };

      const durChart = this.querySelector("#chart-duration");
      if (durChart)
        durChart.data = { labels: monthLabels, values: durValues, unit: "h" };

      const countChart = this.querySelector("#chart-count");
      if (countChart)
        countChart.data = {
          labels: monthLabels,
          values: countValues,
          unit: "",
        };
    }
  }

  render() {
    if (!this._activities) {
      return html`<div class="loading">Loading...</div>`;
    }

    if (this._activities.length === 0) {
      return html`<div class="loading">
        No activities found for this type.
      </div>`;
    }

    let totalDistance = 0;
    let totalDuration = 0;
    for (const a of this._activities) {
      totalDistance += a.distance || 0;
      totalDuration += a.duration || 0;
    }

    return html`
      <div class="detail-header">
        <h2>${formatType(this._type)}</h2>
        <div class="detail-meta">
          <span>${this._activities.length} activities</span>
          <span>${formatDistance(totalDistance)}</span>
          <span>${formatDuration(totalDuration)}</span>
        </div>
      </div>

      <cluster-map class="cluster-map-container"></cluster-map>

      <div class="chart-section">
        <div class="chart-header">Distance per month</div>
        <area-chart id="chart-distance" class="chart-canvas"></area-chart>
      </div>

      <div class="chart-section">
        <div class="chart-header">Duration per month</div>
        <area-chart id="chart-duration" class="chart-canvas"></area-chart>
      </div>

      <div class="chart-section">
        <div class="chart-header">Activities per month</div>
        <area-chart id="chart-count" class="chart-canvas"></area-chart>
      </div>
    `;
  }
}

customElements.define("stats-type-page", StatsTypePage);
