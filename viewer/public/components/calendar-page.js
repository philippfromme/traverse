import { LitElement, html, nothing } from "lit";

import { formatType, formatDistance, formatDuration } from "./utils.js";
import "./custom-select.js";
import { berlinDay } from './race-utils.js';

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
    _selectedDay: { state: true },
    _races: { state: true },
    _raceError: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._activities = [];
    this._races = [];
    this._raceError = '';
    const [year, month] = berlinDay(new Date()).split('-').map(Number);
    this._year = year;
    this._month = month - 1;
    this._selectedDay = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadData();
  }

  async _loadData() {
    this._loadRaces();
    const res = await fetch("/api/activities");
    const data = await res.json();
    this._activities = data.activities;
    this._restoreFromURL();
  }

  async _loadRaces() {
    try {
      const response = await fetch('/api/races');
      if (!response.ok) throw new Error('Could not load races.');
      this._races = (await response.json()).races.filter(r => !r.archived && r.outcome !== 'cancelled');
      this._raceError = '';
    } catch { this._raceError = 'Races could not be loaded.'; }
  }

  _racesForDay(d) {
    const day = `${d.year}-${String(d.month + 1).padStart(2, '0')}-${String(d.date).padStart(2, '0')}`;
    return this._races.filter(r => r.startDate <= day && r.endDate >= day);
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
    this._selectedDay = null;
    this._updateURL();
  }

  _nextMonth() {
    if (this._month === 11) {
      this._month = 0;
      this._year++;
    } else {
      this._month++;
    }
    this._selectedDay = null;
    this._updateURL();
  }

  _today() {
    const [year, month] = berlinDay(new Date()).split('-').map(Number);
    this._year = year;
    this._month = month - 1;
    this._selectedDay = null;
    this._updateURL();
  }

  _onYearChange(e) {
    this._year = parseInt(e.target.value, 10);
    this._selectedDay = null;
    this._updateURL();
  }

  _selectDay(e, key) {
    if (e.target.closest("a")) return;
    this._selectedDay = this._selectedDay === key ? null : key;
  }

  _getAvailableYears() {
    const years = new Set();
    for (const a of this._activities) {
      if (!a.time) continue;
      if (berlinDay(a.time)) years.add(Number(berlinDay(a.time).slice(0, 4)));
    }
    for (const r of this._races) for (let year = Number(r.startDate.slice(0, 4)); year <= Number(r.endDate.slice(0, 4)); year++) years.add(year);
    years.add(Number(berlinDay(new Date()).slice(0, 4)));
    years.add(this._year);
    return Array.from(years).sort((a, b) => a - b);
  }

  _getActivitiesByDate() {
    const map = new Map();
    for (const a of this._activities) {
      if (!a.time) continue;
      const day = berlinDay(a.time);
      if (!day) continue;
      const [year, month, date] = day.split('-').map(Number);
      const key = `${year}-${month - 1}-${date}`;
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
        month: this._month === 0 ? 11 : this._month - 1,
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
          month: this._month === 11 ? 0 : this._month + 1,
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
    const [todayYear, todayMonth, todayDate] = berlinDay(new Date()).split('-').map(Number);
    const isToday = (d) =>
      !d.outside &&
      d.date === todayDate &&
      this._month === todayMonth - 1 &&
      this._year === todayYear;

    return html`
      <div class="calendar-nav">
        <button class="page-btn" @click=${this._prevMonth}>
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <span class="calendar-title">
          ${MONTH_NAMES[this._month]}
          <custom-select
            .value=${String(this._year)}
            .items=${this._getAvailableYears().map((y) => ({ value: String(y), label: String(y) }))}
            @change=${this._onYearChange}
          ></custom-select>
        </span>
        <button class="page-btn" @click=${this._nextMonth}>
          <span class="material-symbols-outlined">arrow_forward</span>
        </button>
        <button class="page-btn calendar-today-btn" @click=${this._today}>
          Today
        </button>
      </div>

      ${this._raceError ? html`<p role="status">${this._raceError} <button class="page-btn" @click=${this._loadRaces}>Retry</button></p>` : nothing}
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
                : ""} ${this._selectedDay === key ? "selected" : ""}"
              @click=${(e) => this._selectDay(e, key)}
            >
              <button class="calendar-date calendar-day-button" aria-label=${`Select ${d.year}-${d.month + 1}-${d.date}`}>${d.date}</button>
              ${this._racesForDay(d).map(r => html`<a class="calendar-race" href=${`/races?year=${r.startDate.slice(0, 4)}&race=${r.id}`}>◆ ${r.name}${r.dateConfirmed ? '' : ' · tentative'}</a>`)}
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
              ${activities.length > 0
                ? html`<div class="calendar-dots">
                    ${activities.map(
                      () => html`<span class="calendar-dot"></span>`,
                    )}
                  </div>`
                : nothing}
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

      ${this._selectedDay
        ? (() => {
            const [selYear, selMonth, selDate] = this._selectedDay
              .split("-")
              .map(Number);
            const selActivities = byDate.get(this._selectedDay) || [];
            return html`
              <div class="calendar-day-detail">
                <div class="calendar-day-detail-header">
                  <span>${selDate} ${MONTH_NAMES[selMonth]}</span>
                  <button
                    class="calendar-day-detail-close"
                    @click=${() => {
                      this._selectedDay = null;
                    }}
                  >
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>
                <a class="calendar-race" href=${`/races?year=${selYear}&add=1&date=${selYear}-${String(selMonth + 1).padStart(2, '0')}-${String(selDate).padStart(2, '0')}`}>+ Add race</a>
                ${this._racesForDay({year:selYear,month:selMonth,date:selDate}).map(r => html`<a class="calendar-race" href=${`/races?year=${r.startDate.slice(0, 4)}&race=${r.id}`}>◆ ${r.name} · ${r.distanceMeters / 1000} km</a>`)}
                ${selActivities.map(
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
          })()
        : nothing}
    `;
  }
}

customElements.define("calendar-page", CalendarPage);
