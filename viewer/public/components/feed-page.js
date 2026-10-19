import { LitElement, html, nothing } from "lit";

import {
  formatDate,
  formatType,
  formatDistance,
  formatDuration,
} from "./utils.js";
import "./feed-map.js";
import { paginateGoals } from "./feed-goals-pagination.js";
import { swipeDirection, wheelSwipe } from "./feed-summary-gestures.js";

const PAGE_SIZE = 20;
const wellnessNumber = (value) => value == null ? "—" : Math.round(value).toLocaleString("en-GB");
const wellnessDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

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
    _summaryPage: { state: true },
    _goals: { state: true },
    _health: { state: true },
    _goalsError: { state: true },
    _goalPages: { state: true },
    _swipeOffset: { state: true },
    _swipeTarget: { state: true },
    _swipeSettling: { state: true },
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
    this._summaryPage = 0;
    this._goals = null;
    this._health = null;
    this._goalsError = false;
    this._goalPages = [];
    this._swipeOffset = 0;
    this._swipeTarget = null;
    this._swipeSettling = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadPage();
    this._loadGoals();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._goalsRequest?.abort();
    this._summaryObserver?.disconnect();
    this._observedSummaryNodes = [];
    cancelAnimationFrame(this._summaryFrame);
    clearTimeout(this._swipeTimer);
    cancelAnimationFrame(this._swipeFrame);
  }

  updated() {
    const nodes = [...this.querySelectorAll('.feed-summary, .feed-goals-categories, .feed-goals-measure')];
    if (nodes.some((node, i) => node !== this._observedSummaryNodes?.[i]) || nodes.length !== this._observedSummaryNodes?.length) {
      this._summaryObserver ||= new ResizeObserver(() => this._scheduleGoalLayout());
      this._summaryObserver.disconnect();
      nodes.forEach(node => this._summaryObserver.observe(node));
      this._observedSummaryNodes = nodes;
    }
    this._scheduleGoalLayout();
  }

  _scheduleGoalLayout() {
    cancelAnimationFrame(this._summaryFrame);
    this._summaryFrame = requestAnimationFrame(() => this._fitGoalPages());
  }

  _fitGoalPages() {
    if (this._swipeTarget !== null) return;
    const container = this.querySelector('.feed-goals-categories');
    const measure = this.querySelector('.feed-goals-measure');
    if (!container || !measure) return;
    const desktop = matchMedia('(min-width: 721px)').matches;
    const items = [...measure.querySelectorAll('.feed-goal')].map(node => ({id:node.dataset.goalId, category:node.closest('section').dataset.category, height:node.getBoundingClientRect().height}));
    const headings = Object.fromEntries([...measure.querySelectorAll('h2')].map(node => [node.closest('section').dataset.category, node.getBoundingClientRect().height + parseFloat(getComputedStyle(node).marginBottom)]));
    const categoryGap = parseFloat(getComputedStyle(measure).rowGap);
    const rowGap = parseFloat(getComputedStyle(measure.querySelector('.feed-goal + .feed-goal') || measure.querySelector('.feed-goal')).marginTop);
    // A short overview also keeps the activity feed reachable on phones.
    const pages = paginateGoals(items, desktop ? container.clientHeight - 1 : 360, headings, categoryGap, rowGap);
    if (JSON.stringify(pages) !== JSON.stringify(this._goalPages)) {
      const goalIndex = this._summaryPage - this._goalStartPage;
      const firstVisible = goalIndex >= 0 ? this._goalPages[goalIndex]?.[0] : null;
      this._goalPages = pages;
      if (goalIndex >= 0) this._summaryPage = this._goalStartPage + Math.max(0, firstVisible ? pages.findIndex(page => page.includes(firstVisible)) : 0);
    }
  }

  async _loadGoals() {
    this._goalsRequest?.abort();
    const request = new AbortController();
    this._goalsRequest = request;
    this._goalsError = false;
    try {
      const response = await fetch("/api/goals", { signal: request.signal });
      if (!response.ok) throw new Error("Could not load goals");
      const data = await response.json();
      if (!request.signal.aborted) {
        this._goals = data;
        if (!data.goals.some(goal => !goal.archived && goal.progress.status !== 'ended')) {
          this._goalPages = [];
          this._summaryPage = Math.min(this._summaryPage, this._goalStartPage);
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        this._goalsError = true;
        this._goalPages = [];
        this._summaryPage = Math.min(this._summaryPage, this._goalStartPage);
      }
    }
  }

  get _summaryPageCount() {
    return this._goalStartPage + Math.max(1, this._goalPages.length);
  }

  get _goalStartPage() {
    return this._health ? 3 : 1;
  }

  _selectSummary(page) {
    if (page === this._summaryPage || this._swipeTarget !== null) return;
    this._prepareSwipe(page, page > this._summaryPage ? 1 : -1);
    this._settleSwipe(true);
  }

  _commitSummary(page) {
    const wasBeforeGoals = this._summaryPage < this._goalStartPage;
    this._summaryPage = Math.min(page, this._summaryPageCount - 1);
    if (page >= this._goalStartPage && wasBeforeGoals) this._loadGoals();
  }

  _prepareSwipe(page, direction) {
    const card = this.querySelector('.feed-summary');
    const gap = parseFloat(getComputedStyle(card).getPropertyValue('--feed-summary-slide-gap'));
    this._swipeWidth = this.querySelector('.feed-summary-viewport').clientWidth + gap;
    this._swipeDirection = direction;
    this._swipeTarget = page;
  }

  async _settleSwipe(commit) {
    if (this._swipeTarget === null || this._swipeSettling) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this._completeSwipe(commit); return; }
    // Paint the incoming page at its initial position before starting the transition.
    await this.updateComplete;
    this._swipeFrame = requestAnimationFrame(() => {
      this._swipeFrame = requestAnimationFrame(() => {
        if (!this.isConnected || this._swipeTarget === null) return;
        this._swipeSettling = true;
        this._swipeOffset = commit ? -this._swipeDirection * this._swipeWidth : 0;
        this._swipeTimer = setTimeout(() => this._completeSwipe(commit), 240);
      });
    });
  }

  _completeSwipe(commit) {
    const target = this._swipeTarget;
    this._swipeOffset = 0;
    this._swipeTarget = null;
    this._swipeSettling = false;
    if (commit && target !== null) this._commitSummary(target);
  }

  _summaryKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const count = this._summaryPageCount;
    const page = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (this._summaryPage + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
    this._selectSummary(page);
    this.updateComplete.then(() => this.querySelector(`#feed-tab-${page}`)?.focus());
  }

  _advanceSummary(direction) {
    const page = (this._summaryPage + direction + this._summaryPageCount) % this._summaryPageCount;
    if (this._swipeTarget !== null) return;
    this._prepareSwipe(page, direction);
    this._settleSwipe(true);
  }

  _summaryPointerDown(event) {
    if (!event.isPrimary || event.button !== 0) { this._cancelPointerSwipe(); return; }
    if (this._swipeTarget !== null) return;
    if (event.target.closest('button, a, input, select, textarea')) return;
    this._summarySwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  _summaryPointerMove(event) {
    const start = this._summarySwipe;
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { this._cancelPointerSwipe(); return; }
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      const direction = dx < 0 ? 1 : -1;
      if (this._swipeTarget === null || direction !== this._swipeDirection) this._prepareSwipe((this._summaryPage + direction + this._summaryPageCount) % this._summaryPageCount, direction);
      this._swipeOffset = Math.max(-this._swipeWidth, Math.min(this._swipeWidth, dx));
    }
  }

  _summaryPointerUp(event) {
    const start = this._summarySwipe;
    this._summarySwipe = null;
    if (!start || event.pointerId !== start.id) return;
    const direction = swipeDirection(event.clientX - start.x, event.clientY - start.y);
    if (direction) {
      event.preventDefault();
      if (this._swipeTarget === null) this._advanceSummary(direction);
      else this._settleSwipe(true);
    } else this._settleSwipe(false);
  }

  _cancelPointerSwipe() {
    if (!this._summarySwipe) return;
    this._summarySwipe = null;
    this._settleSwipe(false);
  }

  _summaryWheel(event) {
    if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientWidth : 1;
    const { state, direction } = wheelSwipe(this._summaryWheelGesture, event.deltaX * scale, event.deltaY * scale, event.timeStamp);
    this._summaryWheelGesture = state;
    if (direction) this._advanceSummary(direction);
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
    await this._loadHealth();
    this._loading = false;
  }

  async _loadHealth() {
    try {
      const datesResponse = await fetch("/api/health/dates");
      if (!datesResponse.ok) return;
      const { dates } = await datesResponse.json();
      if (!dates.length) return;
      const latest = dates[0];
      const [dayResponse, trendResponse] = await Promise.all([
        fetch(`/api/health/day/${latest}`),
        fetch(`/api/health/trends?days=7&end=${latest}`),
      ]);
      if (!dayResponse.ok || !trendResponse.ok) return;
      const [day, trend] = await Promise.all([dayResponse.json(), trendResponse.json()]);
      this._health = { day, days: trend.days };
    } catch {
      // The activity feed remains available when wellness data is unavailable.
    }
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

  _renderMonthSummary() {
    if (!this._monthStats) return nothing;
    const { last, prev, lastMonthName } = this._monthStats;

    return html`
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
    `;
  }

  _renderMovementSummary() {
    const { day, days } = this._health;
    const recorded = days.filter((item) => item.steps != null);
    const withGoal = recorded.filter((item) => item.stepGoal > 0);
    const hits = withGoal.filter((item) => item.steps >= item.stepGoal).length;
    const average = recorded.length ? recorded.reduce((sum, item) => sum + item.steps, 0) / recorded.length : null;
    return html`<div class="feed-summary-title">Movement · 7 days</div>
      <div class="feed-summary-grid">
        <div class="feed-summary-item"><div class="feed-summary-value">${wellnessNumber(average)}</div><div class="feed-summary-label">Average steps / day</div><div class="feed-summary-trend">${recorded.length} of 7 days recorded</div></div>
        <div class="feed-summary-item"><div class="feed-summary-value">${withGoal.length ? `${hits} / ${withGoal.length}` : "—"}</div><div class="feed-summary-label">Step goals reached</div><div class="feed-summary-trend">Days with a saved goal</div></div>
        <div class="feed-summary-item"><div class="feed-summary-value">${wellnessNumber(day.steps)}</div><div class="feed-summary-label">Latest steps</div><div class="feed-summary-trend">${wellnessDate(day.date)}</div></div>
      </div>`;
  }

  _renderRecoverySummary() {
    const { day } = this._health;
    return html`<div class="feed-summary-title">Health · ${wellnessDate(day.date)}</div>
      <div class="feed-summary-grid">
        <div class="feed-summary-item"><div class="feed-summary-value">${wellnessNumber(day.bodyBattery)}</div><div class="feed-summary-label">Body Battery / 100</div><div class="feed-summary-trend">Latest daily value</div></div>
        <div class="feed-summary-item"><div class="feed-summary-value">${wellnessNumber(day.restingHeartRate)}</div><div class="feed-summary-label">Resting heart rate · bpm</div><div class="feed-summary-trend">Daily resting value</div></div>
        <div class="feed-summary-item"><div class="feed-summary-value">${wellnessNumber(day.averageStress)}</div><div class="feed-summary-label">Average stress / 100</div><div class="feed-summary-trend">${day.averageStress == null ? "No reading recorded" : "Daily average"}</div></div>
      </div>`;
  }

  _renderSummaryPage(page, measure = false) {
    if (page === 0) return this._renderMonthSummary();
    if (this._health && page === 1) return this._renderMovementSummary();
    if (this._health && page === 2) return this._renderRecoverySummary();
    return this._renderGoalsSummary(page, measure);
  }

  _renderGoalsSummary(page = this._summaryPage, measure = true) {
    if (this._goalsError) return html`<div class="feed-goals-empty" role="status"><p>Could not load your goals.</p><button class="feed-summary-retry" @click=${this._loadGoals}>Try again</button></div>`;
    if (!this._goals) return html`<p role="status">Loading goals…</p>`;
    const goals = this._goals.goals.filter(goal => !goal.archived && goal.progress.status !== "ended");
    if (!goals.length) return html`<div class="feed-goals-empty"><div class="feed-summary-title">What’s next?</div><p>Set a target for your training, a benchmark or a skill you want to learn.</p></div>`;
    const visibleIds = this._goalPages[Math.max(0, page - this._goalStartPage)];
    const visible = visibleIds ? goals.filter(goal => visibleIds.includes(goal.id)) : goals.slice(0, 1);
    return html`
      <div class="feed-goals-heading"><div class="feed-summary-title">Your goals</div><span>${goals.length} ${goals.length === 1 ? "goal" : "goals"}</span></div>
      <div class="feed-goals-categories">
        <div class="feed-goals-page">${this._renderGoalSections(visible)}</div>
        ${measure ? html`<div class="feed-goals-measure" aria-hidden="true" inert>${this._renderGoalSections(goals)}</div>` : nothing}
      </div>`;
  }

  _renderGoalSections(goals) {
    const number = value => value == null ? "—" : Number(value).toLocaleString("en-GB", { maximumFractionDigits: 1 });
    return this._goals.categories.filter(category => goals.some(goal => goal.category === category.id)).map(category => html`
          <section class="feed-goals-category" data-category=${category.id} aria-label=${category.name}>
            <h2>${category.name}</h2>
            ${goals.filter(goal => goal.category === category.id).map(goal => {
              const progress = goal.progress;
              const status = progress.status === "upcoming" ? "Upcoming" : progress.status === "achieved" ? goal.period === "weekly" ? "Achieved this week" : "Achieved" : goal.period === "weekly" ? "This week" : "In progress";
              return html`<div class="feed-goal" data-goal-id=${goal.id} title=${goal.title}>
                <div class="feed-goal-heading"><span class="feed-goal-title">${goal.title}</span><span class="feed-goal-value">${number(progress.value)} / ${number(goal.target)} ${goal.unit}</span></div>
                <div class="feed-goal-meter" role="progressbar" aria-label=${goal.title} aria-valuemin="0" aria-valuemax=${goal.target} aria-valuenow=${Math.min(progress.value || 0, goal.target)} aria-valuetext=${progress.value == null ? "No benchmark recorded" : `${number(progress.value)} of ${number(goal.target)} ${goal.unit}`}><span style="width:${progress.percent}%"></span></div>
                <div class="feed-goal-meta"><span>${goal.group || status}</span>${goal.group ? html`<span>${status}</span>` : nothing}</div>
              </div>`;
            })}
          </section>`);
  }

  _renderSummary() {
    const count = this._summaryPageCount;
    const indices = count <= 9 ? Array.from({length:count}, (_, i) => i) : [...new Set([0, count - 1, ...Array.from({length:5}, (_, i) => Math.max(1, Math.min(count - 6, this._summaryPage - 2)) + i)])].sort((a, b) => a - b);
    return html`<div class=${"feed-summary" + (this._swipeSettling ? " settling" : "")} @pointerdown=${this._summaryPointerDown} @pointermove=${this._summaryPointerMove} @pointerup=${this._summaryPointerUp} @pointercancel=${this._cancelPointerSwipe} @lostpointercapture=${this._cancelPointerSwipe} @wheel=${this._summaryWheel}>
      <div class="feed-summary-viewport">
        <div class="feed-summary-content" style=${`transform:translateX(${this._swipeOffset}px)`}>
          <div id="feed-panel-month" class="feed-summary-panel" role="tabpanel" aria-labelledby="feed-tab-0" tabindex="0" ?hidden=${this._summaryPage !== 0}>${this._renderMonthSummary()}</div>
          ${this._health ? html`<div id="feed-panel-movement" class="feed-summary-panel" role="tabpanel" aria-labelledby="feed-tab-1" tabindex="0" ?hidden=${this._summaryPage !== 1}>${this._renderMovementSummary()}</div><div id="feed-panel-health" class="feed-summary-panel" role="tabpanel" aria-labelledby="feed-tab-2" tabindex="0" ?hidden=${this._summaryPage !== 2}>${this._renderRecoverySummary()}</div>` : nothing}
          <div id="feed-panel-goals" class=${"feed-summary-panel" + (this._summaryPage < this._goalStartPage ? " inactive" : "")} role="tabpanel" aria-labelledby=${"feed-tab-" + Math.max(this._goalStartPage, this._summaryPage)} aria-hidden=${this._summaryPage < this._goalStartPage ? "true" : "false"} ?inert=${this._summaryPage < this._goalStartPage} tabindex="0">${this._renderGoalsSummary()}</div>
        </div>
        ${this._swipeTarget !== null ? html`<div class="feed-summary-preview" aria-hidden="true" inert style=${`transform:translateX(${this._swipeDirection * this._swipeWidth + this._swipeOffset}px)`}>${this._renderSummaryPage(this._swipeTarget)}</div>` : nothing}
      </div>
      <div class="feed-summary-tabs" role="tablist" aria-label="Overview" @keydown=${this._summaryKeydown}>
        ${indices.map((page, i) => {
          const label = page === 0 ? "Monthly stats" : this._health && page === 1 ? "Movement" : this._health && page === 2 ? "Health" : `Goals · page ${page - this._goalStartPage + 1} of ${count - this._goalStartPage}`;
          const panel = page === 0 ? "feed-panel-month" : this._health && page === 1 ? "feed-panel-movement" : this._health && page === 2 ? "feed-panel-health" : "feed-panel-goals";
          return html`${i && page - indices[i - 1] > 1 ? html`<span class="feed-summary-ellipsis" aria-hidden="true">…</span>` : nothing}<button id=${"feed-tab-" + page} role="tab" aria-label=${label} title=${label} aria-selected=${this._summaryPage === page ? "true" : "false"} aria-controls=${panel} tabindex=${this._summaryPage === page ? "0" : "-1"} @click=${() => this._selectSummary(page)}></button>`;
        })}
      </div>
    </div>`;
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
