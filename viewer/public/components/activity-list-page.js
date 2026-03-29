import { LitElement, html, nothing } from "lit";

import {
  formatDate,
  formatType,
  formatDistance,
  formatDuration,
} from "./utils.js";
import "./custom-select.js";

const PAGE_SIZE = 50;

class ActivityListPage extends LitElement {
  static properties = {
    _activities: { state: true },
    _types: { state: true },
    _summary: { state: true },
    _search: { state: true },
    _type: { state: true },
    _gps: { state: true },
    _sort: { state: true },
    _page: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._activities = [];
    this._types = [];
    this._summary = null;
    this._search = "";
    this._type = "";
    this._gps = "";
    this._sort = "date-desc";
    this._page = 1;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadData();
  }

  async _loadData() {
    const [activitiesRes, summaryRes] = await Promise.all([
      fetch("/api/activities"),
      fetch("/api/summary"),
    ]);
    const data = await activitiesRes.json();
    this._summary = await summaryRes.json();
    this._activities = data.activities;
    this._types = data.types;
    this._restoreFromURL();
  }

  _restoreFromURL() {
    const params = new URLSearchParams(window.location.search);
    this._search = params.get("search") || "";
    this._type = params.get("type") || "";
    this._gps = params.get("gps") || "";
    this._sort = params.get("sort") || "date-desc";
    this._page = parseInt(params.get("page"), 10) || 1;
  }

  _updateURL() {
    const params = new URLSearchParams();
    if (this._search) params.set("search", this._search);
    if (this._type) params.set("type", this._type);
    if (this._gps) params.set("gps", this._gps);
    if (this._sort && this._sort !== "date-desc")
      params.set("sort", this._sort);
    if (this._page > 1) params.set("page", this._page);
    const qs = params.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    history.replaceState(null, "", url);
  }

  get _filteredActivities() {
    let filtered = this._activities;

    if (this._search) {
      filtered = filtered.filter(
        (a) =>
          this._fuzzyMatch(a.name, this._search) ||
          (a.location && this._fuzzyMatch(a.location, this._search)),
      );
    }

    if (this._type) {
      filtered = filtered.filter((a) => a.type === this._type);
    }

    if (this._gps === "with-gps") {
      filtered = filtered.filter((a) => a.hasTrack);
    } else if (this._gps === "without-gps") {
      filtered = filtered.filter((a) => !a.hasTrack);
    }

    return this._sortActivities(filtered);
  }

  _sortActivities(activities) {
    const [field, dir] = this._sort.split("-");
    const mult = dir === "asc" ? 1 : -1;

    return [...activities].sort((a, b) => {
      if (field === "date") {
        const ta = a.time ? new Date(a.time).getTime() : 0;
        const tb = b.time ? new Date(b.time).getTime() : 0;
        return (ta - tb) * mult;
      }
      if (field === "distance")
        return ((a.distance || 0) - (b.distance || 0)) * mult;
      if (field === "duration")
        return ((a.duration || 0) - (b.duration || 0)) * mult;
      if (field === "name") return a.name.localeCompare(b.name) * mult;
      return 0;
    });
  }

  _fuzzyMatch(text, query) {
    text = text.toLowerCase();
    query = query.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  _onSearch(e) {
    this._search = e.target.value;
    this._page = 1;
    this._updateURL();
  }

  _onTypeFilter(e) {
    this._type = e.target.value;
    this._page = 1;
    this._updateURL();
  }

  _onGpsFilter(e) {
    this._gps = e.target.value;
    this._page = 1;
    this._updateURL();
  }

  _onSort(e) {
    this._sort = e.target.value;
    this._page = 1;
    this._updateURL();
  }

  _onPageClick(e) {
    const btn = e.target.closest("[data-page]");
    if (!btn) return;
    this._page = parseInt(btn.dataset.page, 10);
    this._updateURL();
    window.scrollTo({ top: 0 });
  }

  _onRowClick(e) {
    const row = e.target.closest(".activity-row");
    if (row) {
      sessionStorage.setItem("activitiesUrl", window.location.href);
    }
  }

  _renderSummary() {
    if (!this._summary) return nothing;

    const distKm = Math.round(this._summary.totalDistance / 1000);
    const durH = Math.round(this._summary.totalDuration / 3600);

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
    `;
  }

  _renderPagination(totalItems) {
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    if (totalPages <= 1) return nothing;

    const WING = 2;
    const pages = new Set();

    for (let i = 1; i <= Math.min(WING, totalPages); i++) pages.add(i);
    for (let i = Math.max(1, totalPages - WING + 1); i <= totalPages; i++)
      pages.add(i);
    for (
      let i = Math.max(1, this._page - WING);
      i <= Math.min(totalPages, this._page + WING);
      i++
    )
      pages.add(i);

    const sorted = [...pages].sort((a, b) => a - b);
    let prev = 0;
    const parts = [];

    for (const p of sorted) {
      if (p - prev > 1) {
        parts.push(html`<span class="page-ellipsis">&hellip;</span>`);
      }

      if (p === this._page) {
        parts.push(html`<span class="page-num active">${p}</span>`);
      } else {
        parts.push(
          html`<button class="page-btn page-num" data-page="${p}">
            ${p}
          </button>`,
        );
      }

      prev = p;
    }

    return html`
      <div class="pagination" @click=${this._onPageClick}>
        ${this._page > 1
          ? html`<button class="page-btn" data-page="${this._page - 1}">
              <span class="material-symbols-outlined">arrow_back</span>
            </button>`
          : html`<button class="page-btn" disabled>
              <span class="material-symbols-outlined">arrow_back</span>
            </button>`}
        ${parts}
        ${this._page < totalPages
          ? html`<button class="page-btn" data-page="${this._page + 1}">
              <span class="material-symbols-outlined">arrow_forward</span>
            </button>`
          : html`<button class="page-btn" disabled>
              <span class="material-symbols-outlined">arrow_forward</span>
            </button>`}
      </div>
    `;
  }

  render() {
    const filtered = this._filteredActivities;
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const page = Math.min(this._page, totalPages || 1);
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    return html`
      <div class="summary">${this._renderSummary()}</div>
      <div class="filters">
        <input
          type="text"
          placeholder="Search..."
          .value=${this._search}
          @input=${this._onSearch}
        />
        <custom-select
          .value=${this._type}
          @change=${this._onTypeFilter}
          .items=${[
            { value: "", label: "All types" },
            ...this._types.map((t) => ({ value: t, label: formatType(t) })),
          ]}
        ></custom-select>
        <custom-select
          .value=${this._gps}
          @change=${this._onGpsFilter}
          .items=${[
            { value: "", label: "All activities" },
            { value: "with-gps", label: "With GPS" },
            { value: "without-gps", label: "Without GPS" },
          ]}
        ></custom-select>
        <custom-select
          .value=${this._sort}
          @change=${this._onSort}
          .items=${[
            { value: "date-desc", label: "Newest first" },
            { value: "date-asc", label: "Oldest first" },
            { value: "distance-desc", label: "Distance ↓" },
            { value: "distance-asc", label: "Distance ↑" },
            { value: "duration-desc", label: "Duration ↓" },
            { value: "duration-asc", label: "Duration ↑" },
            { value: "name-asc", label: "Name A–Z" },
            { value: "name-desc", label: "Name Z–A" },
          ]}
        ></custom-select>
      </div>
      <div class="table-group">
        <div class="table-header">
          <span>Date</span>
          <span>Type</span>
          <span>Name</span>
          <span>Location</span>
          <span>Distance</span>
          <span>Duration</span>
          <span>Avg HR</span>
        </div>
        <div class="activity-list" @click=${this._onRowClick}>
          ${pageItems.length === 0
            ? html`<div class="loading">No activities found.</div>`
            : pageItems.map((a) => {
                const dist =
                  a.distance > 0
                    ? a.distance >= 1000
                      ? `${(a.distance / 1000).toFixed(1)} km`
                      : `${Math.round(a.distance)} m`
                    : "";
                const dur = a.duration > 0 ? formatDuration(a.duration) : "";
                const hr = a.averageHR ? `${a.averageHR} bpm` : "";

                return html`
                  <a href="/activity/${a.id}" class="activity-row">
                    <span class="col-date">${formatDate(a.time)}</span>
                    <span class="col-type">${formatType(a.type)}</span>
                    <span class="col-name">${a.name}</span>
                    <span class="col-location">${a.location || ""}</span>
                    <span class="col-distance">${dist}</span>
                    <span class="col-duration">${dur}</span>
                    <span class="col-hr">${hr}</span>
                  </a>
                `;
              })}
        </div>
        ${this._renderPagination(filtered.length)}
      </div>
    `;
  }
}

customElements.define("activity-list-page", ActivityListPage);
