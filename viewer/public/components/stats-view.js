import { LitElement, html, nothing } from "lit";
import { formatDate, formatDistance, formatDuration, formatType } from "./utils.js";
import { activityDate, buildBuckets, dateInputValue, inRange, previousRange, selectedRange, totals } from "./stats-data.js";
import "./cluster-map.js";
import "./custom-checkbox.js";
import "./custom-select.js";
import "./stats-chart.js";

const METRICS = [
  { key: "distance", title: "Distance", unit: "km", value: (t) => t.distance / 1000 },
  { key: "duration", title: "Duration", unit: "h", value: (t) => t.duration / 3600 },
  { key: "count", title: "Activities", unit: "", value: (t) => t.count },
];

class StatsView extends LitElement {
  static properties = {
    _activities: { state: true },
    _period: { state: true },
    _from: { state: true },
    _to: { state: true },
    _granularity: { state: true },
    _chartType: { state: true },
    _compare: { state: true },
    _selectedBucket: { state: true },
    _error: { state: true },
  };

  createRenderRoot() { return this; }

  constructor() {
    super();
    this._activities = null;
    this._period = "all";
    this._granularity = "month";
    this._chartType = "area";
    this._compare = false;
    this._selectedBucket = null;
    this._error = "";
    const now = new Date();
    this._from = dateInputValue(new Date(now.getFullYear(), 0, 1));
    this._to = dateInputValue(now);
  }

  connectedCallback() {
    super.connectedCallback();
    const parts = window.location.pathname.split("/");
    this._type = parts[1] === "stats" && parts.length > 2
      ? decodeURIComponent(parts[parts.length - 1]) : null;
    if (this._type) document.title = `Traverse — ${formatType(this._type)}`;
    this._loadData();
  }

  async _loadData() {
    try {
      const url = this._type
        ? `/api/activities?type=${encodeURIComponent(this._type)}`
        : "/api/activities";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not load activities.");
      this._activities = (await response.json()).activities;
    } catch (error) {
      this._error = error.message;
    }
  }

  updated(changed) {
    if (!this._activities) return;
    if (["_activities", "_period", "_from", "_to", "_selectedBucket", "_granularity", "_compare", "_chartType"].some((key) => changed.has(key))) {
      const range = selectedRange(this._activities, this._period, this._from, this._to);
      const current = this._activities.filter((a) => inRange(a, range));
      const prior = previousRange(range, this._period);
      const previous = prior ? this._activities.filter((a) => inRange(a, prior)) : [];
      const buckets = buildBuckets(range, this._granularity, current, previous, this._period);
      this._buckets = buckets;
      for (const metric of METRICS) {
        const chart = this.querySelector(`#stats-chart-${metric.key}`);
        if (!chart) continue;
        chart.data = {
          labels: buckets.map((b) => b.label),
          values: buckets.map((b) => metric.value(b.current)),
          previous: this._compare && prior ? buckets.map((b) => metric.value(b.previous)) : null,
          unit: metric.unit,
          type: this._chartType,
          selectedIndex: this._selectedBucket,
        };
      }
      if (["_activities", "_period", "_from", "_to", "_selectedBucket"].some((key) => changed.has(key))) {
        const selected = this._selectedBucket == null ? null : buckets[this._selectedBucket];
        const visible = selected ? current.filter((a) => {
          const date = activityDate(a);
          return date && date >= selected.start && date < selected.end;
        }) : current;
        const map = this.querySelector("cluster-map");
        if (map) {
          map.showRoutes = !!selected;
          map.fitOnUpdate = true;
          map.activities = visible;
        }
      }
    }
  }

  _setPeriod(event) {
    this._period = event.target.value;
    this._selectedBucket = null;
    if (this._period === "all") this._compare = false;
  }

  _setFrom(event) { this._from = event.target.value; this._selectedBucket = null; }
  _setTo(event) { this._to = event.target.value; this._selectedBucket = null; }
  _setGranularity(event) { this._granularity = event.target.value; this._selectedBucket = null; }

  _onBucket(event) {
    const index = event.detail.index;
    this._selectedBucket = this._selectedBucket === index ? null : index;
    if (this._selectedBucket != null) {
      this.updateComplete.then(() => this.querySelector("#stats-selection")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  _delta(current, previous) {
    if (previous === 0) return current === 0 ? "No change" : "New vs previous period";
    const percent = Math.round(((current - previous) / previous) * 100);
    return `${percent > 0 ? "+" : ""}${percent}% vs previous period`;
  }

  _renderControls() {
    return html`
      <div class="stats-controls">
        <label>Period
          <custom-select aria-label="Period" .value=${this._period} @change=${this._setPeriod}
            .items=${[
              { value: "all", label: "All time" },
              { value: "30d", label: "Last 30 days" },
              { value: "90d", label: "Last 90 days" },
              { value: "year", label: "This year" },
              { value: "12m", label: "Last 12 months" },
              { value: "custom", label: "Custom range" },
            ]}></custom-select>
        </label>
        ${this._period === "custom" ? html`
          <label>From <input type="date" .value=${this._from} @change=${this._setFrom}></label>
          <label>To <input type="date" .value=${this._to} @change=${this._setTo}></label>
        ` : nothing}
        <label>Group by
          <custom-select aria-label="Group by" .value=${this._granularity} @change=${this._setGranularity}
            .items=${[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
            ]}></custom-select>
        </label>
        <label>Chart
          <custom-select aria-label="Chart" .value=${this._chartType}
            @change=${(e) => { this._chartType = e.target.value; }}
            .items=${[
              { value: "area", label: "Area" },
              { value: "line", label: "Line" },
              { value: "bar", label: "Bar" },
            ]}></custom-select>
        </label>
        <div class="stats-compare-control">
          <span>Compare</span>
          <custom-checkbox aria-label="Compare previous period" .label=${"Previous period"}
            .checked=${this._compare} .disabled=${this._period === "all"}
            @change=${(e) => { this._compare = e.target.checked; }}></custom-checkbox>
        </div>
      </div>
    `;
  }

  _renderTotals(current, previous, canCompare) {
    const cards = [
      { label: "Activities", value: current.count.toLocaleString(), key: "count" },
      { label: "Kilometers", value: Math.round(current.distance / 1000).toLocaleString(), key: "distance" },
      { label: "Hours", value: Math.round(current.duration / 3600).toLocaleString(), key: "duration" },
    ];
    return html`<div class="summary-totals">
      ${cards.map((card) => html`<div class="stat-card summary-hero">
        <div class="stat-value">${card.value}</div>
        <div class="stat-label">${card.label}</div>
        ${canCompare ? html`<div class="stats-delta">${this._delta(current[card.key], previous[card.key])}</div>` : nothing}
      </div>`)}
    </div>`;
  }

  _renderTypeTable(activities) {
    const byType = new Map();
    for (const activity of activities) {
      if (!byType.has(activity.type)) byType.set(activity.type, []);
      byType.get(activity.type).push(activity);
    }
    const rows = [...byType].map(([type, list]) => [type, totals(list)])
      .sort((a, b) => b[1].distance - a[1].distance);
    return html`<div class="table-group">
      <div class="table-header stats-table-header"><span>Type</span><span>Count</span><span>Distance</span><span>Duration</span></div>
      <div class="activity-list">
        ${rows.map(([type, sum]) => html`<a href="/stats/${encodeURIComponent(type)}" class="activity-row">
          <span class="col-type">${formatType(type)}</span>
          <span class="col-name">${sum.count} activities</span>
          <span class="col-distance">${sum.distance ? formatDistance(sum.distance) : ""}</span>
          <span class="col-duration">${sum.duration ? formatDuration(sum.duration) : ""}</span>
        </a>`)}
      </div>
    </div>`;
  }

  _renderSelection(activities, bucket) {
    if (!bucket) return nothing;
    const selected = activities.filter((a) => {
      const date = activityDate(a);
      return date && date >= bucket.start && date < bucket.end;
    }).sort((a, b) => new Date(b.time) - new Date(a.time));
    return html`<section id="stats-selection" class="stats-selection">
      <div class="stats-selection-head">
        <div><h3>${bucket.label}</h3><p>${selected.length} activities in this period${selected.length > 80 ? " · Map shows routes for the latest 80" : ""}</p></div>
        <button type="button" @click=${() => { this._selectedBucket = null; }}>Clear selection</button>
      </div>
      ${selected.length ? html`<div class="stats-activity-list">
        ${selected.map((a) => html`<a href="/activity/${encodeURIComponent(a.id)}" class="stats-activity-row">
          <span>${formatDate(a.time)}</span><strong>${a.name || "Untitled activity"}</strong>
          ${!this._type ? html`<span>${formatType(a.type || "other")}</span>` : nothing}
          <span>${a.distance ? formatDistance(a.distance) : ""}</span>
          <span>${a.duration ? formatDuration(a.duration) : ""}</span>
        </a>`)}
      </div>` : html`<p class="stats-empty">No activities in this period.</p>`}
    </section>`;
  }

  render() {
    if (this._error) return html`<div class="loading">${this._error}</div>`;
    if (!this._activities) return html`<div class="loading">Loading...</div>`;
    const range = selectedRange(this._activities, this._period, this._from, this._to);
    const current = this._activities.filter((a) => inRange(a, range));
    const prior = previousRange(range, this._period);
    const previous = prior ? this._activities.filter((a) => inRange(a, prior)) : [];
    const sum = totals(current);
    const prevSum = totals(previous);
    const buckets = buildBuckets(range, this._granularity, current, previous, this._period);
    const bucket = this._selectedBucket == null ? null : buckets[this._selectedBucket];
    const mapped = bucket ? current.filter((a) => {
      const date = activityDate(a);
      return date && date >= bucket.start && date < bucket.end;
    }) : current;
    const hasCoords = mapped.some((a) => a.startLat != null && a.startLon != null);
    return html`
      ${this._type ? html`<div class="detail-header"><h2>${formatType(this._type)}</h2></div>` : nothing}
      ${this._renderControls()}
      ${!range ? html`<p class="stats-empty">Choose a valid date range.</p>` : html`
        ${this._renderTotals(sum, prevSum, this._compare && !!prior)}
        <div class="stats-chart-grid">
          ${METRICS.map((metric) => html`<section class="chart-section">
            <div class="chart-header">${metric.title} per ${this._granularity}</div>
            <stats-chart id="stats-chart-${metric.key}" class="chart-canvas" @bucket-select=${this._onBucket}></stats-chart>
          </section>`)}
        </div>
        ${this._compare && prior ? html`<div class="stats-legend"><span class="stats-legend-current"></span> Selected period <span class="stats-legend-previous"></span> Previous period</div>` : nothing}
        ${hasCoords ? html`<cluster-map class="cluster-map-container"></cluster-map>` : html`<p class="no-gps">No GPS locations for this selection.</p>`}
        ${this._renderSelection(current, bucket)}
        ${!this._type ? this._renderTypeTable(current) : nothing}
      `}
    `;
  }
}

customElements.define("stats-view", StatsView);
