import { LitElement, html, nothing } from "lit";

import { formatType, formatDistance, formatDuration } from "./utils.js";

const MONTH_NAMES = [
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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

class CalendarPage extends LitElement {
  static properties = {
    _activities: { state: true },
    _year: { state: true },
    _month: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._activities = [];
    const now = new Date();
    this._year = now.getFullYear();
    this._month = now.getMonth();
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadData();
  }

  async _loadData() {
    const res = await fetch("/api/activities");
    const data = await res.json();
    this._activities = data.activities;
    this._restoreFromURL();
  }

  _restoreFromURL() {
    const params = new URLSearchParams(window.location.search);
    const y = parseInt(params.get("year"), 10);
    const m = parseInt(params.get("month"), 10);
    if (y && m >= 1 && m <= 12) {
      this._year = y;
      this._month = m - 1;
    }
  }

  _updateURL() {
    const params = new URLSearchParams();
    params.set("year", this._year);
    params.set("month", this._month + 1);
    const url = `?${params.toString()}`;
    history.replaceState(null, "", url);
  }

  _prevMonth() {
    if (this._month === 0) {
      this._month = 11;
      this._year--;
    } else {
      this._month--;
    }
    this._updateURL();
  }

  _nextMonth() {
    if (this._month === 11) {
      this._month = 0;
      this._year++;
    } else {
      this._month++;
    }
    this._updateURL();
  }

  _today() {
    const now = new Date();
    this._year = now.getFullYear();
    this._month = now.getMonth();
    this._updateURL();
  }

  _getActivitiesByDate() {
    const map = new Map();
    for (const a of this._activities) {
      if (!a.time) continue;
      const d = new Date(a.time);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    return map;
  }

  _getCalendarDays() {
    const firstDay = new Date(this._year, this._month, 1);
    const lastDay = new Date(this._year, this._month + 1, 0);

    // Monday = 0, Sunday = 6
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const days = [];

    // Leading days from previous month
    const prevMonthLast = new Date(this._year, this._month, 0);
    for (let i = startDow - 1; i >= 0; i--) {
      days.push({
        date: prevMonthLast.getDate() - i,
        month: this._month - 1,
        year: this._month === 0 ? this._year - 1 : this._year,
        outside: true,
      });
    }

    // Current month days
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({
        date: d,
        month: this._month,
        year: this._year,
        outside: false,
      });
    }

    // Trailing days to fill the grid
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        days.push({
          date: d,
          month: this._month + 1,
          year: this._month === 11 ? this._year + 1 : this._year,
          outside: true,
        });
      }
    }

    return days;
  }

  _getWeekSummaries(days, byDate) {
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      const weekDays = days.slice(i, i + 7);
      let distance = 0;
      let duration = 0;
      let count = 0;
      for (const d of weekDays) {
        const key = `${d.year}-${d.month}-${d.date}`;
        const activities = byDate.get(key) || [];
        for (const a of activities) {
          distance += a.distance || 0;
          duration += a.duration || 0;
          count++;
        }
      }
      weeks.push({ distance, duration, count });
    }
    return weeks;
  }

  render() {
    const byDate = this._getActivitiesByDate();
    const days = this._getCalendarDays();
    const weekSummaries = this._getWeekSummaries(days, byDate);
    const today = new Date();
    const isToday = (d) =>
      !d.outside &&
      d.date === today.getDate() &&
      this._month === today.getMonth() &&
      this._year === today.getFullYear();

    return html`
      <div class="calendar-nav">
        <button class="page-btn" @click=${this._prevMonth}>
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <span class="calendar-title"
          >${MONTH_NAMES[this._month]} ${this._year}</span
        >
        <button class="page-btn" @click=${this._nextMonth}>
          <span class="material-symbols-outlined">arrow_forward</span>
        </button>
        <button class="page-btn calendar-today-btn" @click=${this._today}>
          Today
        </button>
      </div>

      <div class="calendar-grid">
        ${DAY_NAMES.map((d) => html`<div class="calendar-dow">${d}</div>`)}
        <div class="calendar-dow"></div>
        ${days.map((d, i) => {
          const key = `${d.year}-${d.month}-${d.date}`;
          const activities = byDate.get(key) || [];
          const weekIdx = Math.floor(i / 7);
          const isLastInWeek = i % 7 === 6;

          const cell = html`
            <div
              class="calendar-cell ${d.outside ? "outside" : ""} ${isToday(d)
                ? "today"
                : ""}"
            >
              <div class="calendar-date">${d.date}</div>
              ${activities.map(
                (a) => html`
                  <a
                    href="/activity/${a.id}"
                    class="calendar-activity"
                    data-type="${a.type}"
                  >
                    <span class="calendar-activity-type"
                      >${formatType(a.type)}</span
                    >
                    <span class="calendar-activity-name">${a.name}</span>
                    ${a.distance > 0
                      ? html`<span class="calendar-activity-dist"
                          >${formatDistance(a.distance)}</span
                        >`
                      : nothing}
                  </a>
                `,
              )}
            </div>
          `;

          if (!isLastInWeek) return cell;

          const week = weekSummaries[weekIdx];
          return html`
            ${cell}
            <div class="calendar-week-summary">
              ${week.count > 0
                ? html`
                    <div class="calendar-week-stat">
                      <div class="calendar-week-value">
                        ${formatDistance(week.distance)}
                      </div>
                      <div class="calendar-week-label">Distance</div>
                    </div>
                    <div class="calendar-week-stat">
                      <div class="calendar-week-value">
                        ${formatDuration(week.duration)}
                      </div>
                      <div class="calendar-week-label">Time</div>
                    </div>
                    <div class="calendar-week-stat">
                      <div class="calendar-week-value">${week.count}</div>
                      <div class="calendar-week-label">
                        ${week.count === 1 ? "Activity" : "Activities"}
                      </div>
                    </div>
                  `
                : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }
}

customElements.define("calendar-page", CalendarPage);
