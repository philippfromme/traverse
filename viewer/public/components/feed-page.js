import { LitElement, html, nothing } from "lit";

import {
  cssVar,
  formatDate,
  formatType,
  formatDistance,
  formatDuration,
} from "./utils.js";
import "./feed-map.js";

const PAGE_SIZE = 20;

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthName(key) {
  const [y, m] = key.split("-");
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function computeMonthStats(activities) {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const lastKey = getMonthKey(lastMonth);
  const prevKey = getMonthKey(prevMonth);

  const stats = {
    last: { dist: 0, dur: 0, count: 0 },
    prev: { dist: 0, dur: 0, count: 0 },
  };

  for (const a of activities) {
    if (!a.time) continue;
    const key = getMonthKey(new Date(a.time));
    if (key === lastKey) {
      stats.last.dist += a.distance || 0;
      stats.last.dur += a.duration || 0;
      stats.last.count += 1;
    } else if (key === prevKey) {
      stats.prev.dist += a.distance || 0;
      stats.prev.dur += a.duration || 0;
      stats.prev.count += 1;
    }
  }

  stats.lastMonthName = formatMonthName(lastKey);
  return stats;
}

function trendPct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

class FeedPage extends LitElement {
  static properties = {
    _activities: { state: true },
    _page: { state: true },
    _loading: { state: true },
    _hasMore: { state: true },
    _monthStats: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._activities = [];
    this._page = 1;
    this._loading = true;
    this._hasMore = true;
    this._monthStats = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadPage();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  async _loadPage() {
    this._loading = true;
    const res = await fetch("/api/activities");
    const data = await res.json();

    // sort newest first, then paginate client-side
    const sorted = data.activities.sort(
      (a, b) => new Date(b.time) - new Date(a.time),
    );
    this._allActivities = sorted;
    this._activities = sorted.slice(0, PAGE_SIZE);
    this._hasMore = sorted.length > PAGE_SIZE;
    this._monthStats = computeMonthStats(sorted);
    this._loading = false;
  }

  _loadMore() {
    const nextEnd = (this._page + 1) * PAGE_SIZE;
    this._page++;
    this._activities = this._allActivities.slice(0, nextEnd);
    this._hasMore = nextEnd < this._allActivities.length;
  }

  _renderCard(activity) {
    const dist = activity.distance > 0 ? formatDistance(activity.distance) : "";
    const dur = activity.duration > 0 ? formatDuration(activity.duration) : "";

    return html`
      <a href="/activity/${activity.id}" class="feed-card">
        <div class="feed-card-title">${activity.name}</div>
        <div class="feed-card-badges">
          <span class="feed-badge badge-date"
            >${formatDate(activity.time)}</span
          >
          <span class="feed-badge badge-type"
            >${formatType(activity.type)}</span
          >
          ${activity.location
            ? html`<span class="feed-badge badge-location"
                >${activity.location}</span
              >`
            : nothing}
          ${dist
            ? html`<span class="feed-badge badge-dist">${dist}</span>`
            : nothing}
          ${dur
            ? html`<span class="feed-badge badge-dur">${dur}</span>`
            : nothing}
        </div>
        ${activity.hasTrack
          ? html`<feed-map
              class="feed-card-map"
              .activityId=${activity.id}
            ></feed-map>`
          : nothing}
      </a>
    `;
  }

  _renderTrend(current, previous, label) {
    const pct = trendPct(current, previous);
    const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
    const cls =
      pct > 0
        ? "feed-summary-trend up"
        : pct < 0
          ? "feed-summary-trend down"
          : "feed-summary-trend flat";
    return html`<span class=${cls}>${arrow} ${Math.abs(pct)}% ${label}</span>`;
  }

  _renderSummary() {
    if (!this._monthStats) return nothing;
    const { last, prev, lastMonthName } = this._monthStats;

    if (last.count === 0 && prev.count === 0) return nothing;

    return html`
      <div class="feed-summary">
        <div class="feed-summary-title">${lastMonthName}</div>
        <div class="feed-summary-grid">
          <div class="feed-summary-item">
            <div class="feed-summary-value">${last.count}</div>
            <div class="feed-summary-label">Activities</div>
            ${this._renderTrend(last.count, prev.count, "vs prev month")}
          </div>
          <div class="feed-summary-item">
            <div class="feed-summary-value">${formatDistance(last.dist)}</div>
            <div class="feed-summary-label">Distance</div>
            ${this._renderTrend(last.dist, prev.dist, "vs prev month")}
          </div>
          <div class="feed-summary-item">
            <div class="feed-summary-value">${formatDuration(last.dur)}</div>
            <div class="feed-summary-label">Time</div>
            ${this._renderTrend(last.dur, prev.dur, "vs prev month")}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">Loading...</div>`;
    }

    return html`
      <div class="feed-layout">
        <aside class="feed-sidebar">${this._renderSummary()}</aside>
        <div class="feed-main">
          <div class="feed-list">
            ${this._activities.map((a) => this._renderCard(a))}
          </div>
          ${this._hasMore
            ? html`<div class="feed-load-more">
                <button class="feed-load-more-btn" @click=${this._loadMore}>
                  Load more
                </button>
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }
}

customElements.define("feed-page", FeedPage);
