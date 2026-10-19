import { LitElement, html, nothing } from "lit";
import "./custom-select.js";

const number = (value) => value == null ? "—" : Math.round(value).toLocaleString("en-GB");
const duration = (seconds) => seconds == null ? "—" : `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}m`;
const dayLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const shortMonth = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const periodOptions = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last 365 days" },
];

const trends = [
  { key: "steps", label: "Steps", format: number, scale: "zero" },
  { key: "bodyBattery", label: "Body Battery", format: number, scale: "hundred" },
  { key: "restingHeartRate", label: "Resting heart rate", format: (value) => `${number(value)} bpm`, scale: "range" },
  { key: "averageStress", label: "Average stress", format: number, scale: "hundred" },
  { key: "sleepSeconds", label: "Sleep", format: duration, scale: "zero" },
];

class HealthPage extends LitElement {
  static properties = {
    _dates: { state: true },
    _date: { state: true },
    _day: { state: true },
    _trendDays: { state: true },
    _period: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _pickerOpen: { state: true },
    _pickerYear: { state: true },
    _pickerMonth: { state: true },
  };

  constructor() {
    super();
    this._dates = [];
    this._date = "";
    this._day = null;
    this._trendDays = [];
    this._period = "7";
    this._loading = true;
    this._error = "";
    this._request = 0;
    this._trendRequest = 0;
    this._pickerOpen = false;
    this._pickerYear = 0;
    this._pickerMonth = 0;
    this._onDocumentClick = this._onDocumentClick.bind(this);
    this._onDocumentKeydown = this._onDocumentKeydown.bind(this);
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocumentClick);
    document.addEventListener("keydown", this._onDocumentKeydown);
    this._load();
  }

  disconnectedCallback() {
    document.removeEventListener("click", this._onDocumentClick);
    document.removeEventListener("keydown", this._onDocumentKeydown);
    super.disconnectedCallback();
  }

  _onDocumentClick(event) {
    if (this._pickerOpen && !this.querySelector(".health-date-picker")?.contains(event.target)) this._pickerOpen = false;
  }

  _onDocumentKeydown(event) {
    if (this._pickerOpen && event.key === "Escape") this._pickerOpen = false;
  }

  async _load() {
    this._loading = true;
    this._error = "";
    this._day = null;
    this._trendDays = [];
    try {
      const response = await fetch("/api/health/dates");
      if (!response.ok) throw new Error("Could not load health dates");
      this._dates = (await response.json()).dates;
      const requested = new URLSearchParams(location.search).get("date");
      if (this._dates.length) await this._selectDate(this._dates.includes(requested) ? requested : this._dates[0]);
    } catch (error) {
      this._error = error.message;
    } finally {
      this._loading = false;
    }
  }

  async _selectDate(date) {
    if (!this._dates.includes(date)) return;
    const request = ++this._request;
    const trendRequest = ++this._trendRequest;
    this._date = date;
    this._day = null;
    this._trendDays = [];
    this._error = "";
    const url = new URL(location.href);
    url.searchParams.set("date", date);
    history.replaceState(null, "", url);
    try {
      const [dayResponse, trendResponse] = await Promise.all([
        fetch(`/api/health/day/${date}`),
        fetch(`/api/health/trends?days=${this._period}&end=${date}`),
      ]);
      if (!dayResponse.ok || !trendResponse.ok) throw new Error("Could not load health data");
      const [day, trend] = await Promise.all([dayResponse.json(), trendResponse.json()]);
      if (request !== this._request) return;
      this._day = day;
      if (trendRequest === this._trendRequest) this._trendDays = trend.days;
    } catch (error) {
      if (request === this._request) this._error = error.message;
    }
  }

  async _changePeriod(event) {
    this._period = event.target.value;
    if (!this._date) return;
    const request = ++this._trendRequest;
    this._error = "";
    try {
      const response = await fetch(`/api/health/trends?days=${this._period}&end=${this._date}`);
      if (!response.ok) throw new Error("Could not load health trends");
      const trend = await response.json();
      if (request === this._trendRequest) this._trendDays = trend.days;
    } catch (error) {
      if (request === this._trendRequest) this._error = error.message;
    }
  }

  _navigate(offset) {
    const index = this._dates.indexOf(this._date);
    this._pickerOpen = false;
    this._selectDate(this._dates[index + offset]);
  }

  _togglePicker() {
    if (!this._pickerOpen) {
      this._pickerYear = Number(this._date.slice(0, 4));
      this._pickerMonth = Number(this._date.slice(5, 7)) - 1;
    }
    this._pickerOpen = !this._pickerOpen;
  }

  _shiftPickerMonth(offset) {
    const date = new Date(Date.UTC(this._pickerYear, this._pickerMonth + offset, 1));
    this._pickerYear = date.getUTCFullYear();
    this._pickerMonth = date.getUTCMonth();
  }

  _changePickerYear(event) {
    this._pickerYear = Number(event.target.value);
    const months = this._dates.filter((date) => date.startsWith(`${this._pickerYear}-`)).map((date) => Number(date.slice(5, 7)) - 1);
    if (!months.includes(this._pickerMonth)) this._pickerMonth = Math.max(...months);
  }

  _pickDay(date) {
    this._pickerOpen = false;
    this._selectDate(date);
  }

  _datePicker() {
    const year = this._pickerYear;
    const month = this._pickerMonth;
    const leading = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const yearOptions = [...new Set(this._dates.map((date) => date.slice(0, 4)))].map((value) => ({ value, label: value }));
    const currentMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
    const oldestMonth = this._dates.at(-1).slice(0, 7);
    const newestMonth = this._dates[0].slice(0, 7);
    return html`<div class="health-date-popover" id="health-date-popover" role="dialog" aria-label="Choose health date">
      <div class="health-picker-nav">
        <button type="button" aria-label="Previous month" ?disabled=${currentMonth <= oldestMonth} @click=${() => this._shiftPickerMonth(-1)}><span class="material-symbols-outlined">chevron_left</span></button>
        <div class="health-picker-title"><span>${monthNames[month]}</span><custom-select aria-label="Year" .value=${String(year)} .items=${yearOptions} @change=${this._changePickerYear}></custom-select></div>
        <button type="button" aria-label="Next month" ?disabled=${currentMonth >= newestMonth} @click=${() => this._shiftPickerMonth(1)}><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
      <div class="health-picker-grid">
        ${weekDays.map((day) => html`<span class="health-picker-weekday">${day}</span>`)}
        ${Array.from({ length: leading }, () => html`<span></span>`)}
        ${Array.from({ length: dayCount }, (_, index) => {
          const day = index + 1;
          const date = `${currentMonth}-${String(day).padStart(2, "0")}`;
          const available = this._dates.includes(date);
          return html`<button type="button" class="health-picker-day ${date === this._date ? "selected" : ""}" ?disabled=${!available}
            aria-label=${dayLabel(date)} aria-pressed=${date === this._date ? "true" : "false"} @click=${() => this._pickDay(date)}>${day}</button>`;
        })}
      </div>
      <p>Days with saved data are selectable.</p>
    </div>`;
  }

  _metric(label, value, unit = "", detail = nothing, className = "") {
    return html`<article class="health-metric ${className}">
      <p class="health-eyebrow">${label}</p>
      <div class="health-metric-value">${value}<small>${unit}</small></div>
      ${detail === nothing ? nothing : html`<div class="health-metric-detail">${detail}</div>`}
    </article>`;
  }

  _trendBuckets() {
    const available = new Set(this._dates);
    const groups = new Map();
    this._trendDays.forEach((day, index) => {
      const key = Number(this._period) <= 30 ? day.date : this._period === "365" ? day.date.slice(0, 7) : String(Math.floor(index / 7));
      if (!groups.has(key)) groups.set(key, { start: day.date, end: day.date, rows: [], selectableDate: null });
      const group = groups.get(key);
      group.end = day.date;
      group.rows.push(day);
      if (available.has(day.date)) group.selectableDate = day.date;
    });
    return [...groups.values()];
  }

  _chart(config, buckets) {
    const summaries = buckets.map((bucket) => {
      const samples = bucket.rows.map((day) => day[config.key]).filter((value) => value != null);
      return { ...bucket, count: samples.length, value: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null };
    });
    const values = summaries.map((bucket) => bucket.value).filter((value) => value != null);
    const max = config.scale === "hundred" ? 100 : Math.max(...values, 1);
    const floor = config.scale === "range" && values.length ? Math.max(0, Math.min(...values) - 8) : 0;
    const ceiling = config.scale === "range" && values.length ? Math.max(...values) + 8 : max;
    const selected = summaries.find((bucket) => bucket.start <= this._date && this._date <= bucket.end)?.value;
    const grouped = Number(this._period) > 30;
    const cadence = this._period === "365" ? "monthly" : grouped ? "weekly" : "daily";
    const axis = this._period === "365" ? shortMonth : shortDay;
    return html`<article class="health-chart">
      <div class="health-chart-header">
        <h3>${config.label}</h3>
        <span title=${grouped ? "Selected period's daily average" : "Selected day"}>${selected == null ? "—" : config.format(selected)}</span>
      </div>
      <div class="health-bars" role="group" aria-label=${`${config.label} for the last ${this._period} days, ${cadence} bars`}>
        ${summaries.map((bucket) => {
          const value = bucket.value;
          const height = value == null ? 0 : Math.max(value === 0 ? 2 : 6, Math.min(100, (value - floor) / Math.max(ceiling - floor, 1) * 100));
          const period = bucket.start === bucket.end ? shortDay(bucket.start) : `${shortDay(bucket.start)}–${shortDay(bucket.end)}`;
          const label = `${period}: ${value == null ? "No data" : `${config.format(value)}${grouped ? ` daily average from ${bucket.count} day${bucket.count === 1 ? "" : "s"}` : ""}`}`;
          return html`<button type="button" class="health-bar-slot ${bucket.start <= this._date && this._date <= bucket.end ? "selected" : ""} ${value == null ? "missing" : ""}"
            title=${label} aria-label=${label} ?disabled=${!bucket.selectableDate} @click=${() => this._selectDate(bucket.selectableDate)}>
            <span class="health-bar" style=${`height:${height}%`}></span>
          </button>`;
        })}
      </div>
      <div class="health-chart-axis"><span>${axis(buckets[0]?.start)}</span><span>${axis(buckets.at(-1)?.end)}</span></div>
    </article>`;
  }

  render() {
    const day = this._day;
    const index = this._dates.indexOf(this._date);
    const goalPercent = day?.steps != null && day.stepGoal ? Math.min(100, day.steps / day.stepGoal * 100) : 0;
    const availableTrendDays = this._trendDays.filter((row) => this._dates.includes(row.date)).length;
    const buckets = this._trendBuckets();
    const grouping = this._period === "365" ? "Monthly" : Number(this._period) > 30 ? "Weekly" : "Daily";
    return html`
      <header class="health-heading">
        <div><h1>Health</h1><p>Daily wellness data from Garmin Connect.</p></div>
        ${this._date ? html`<div class="health-date-picker"><div class="health-date-nav" aria-label="Choose day">
          <button type="button" aria-label="Previous available day" ?disabled=${index >= this._dates.length - 1} @click=${() => this._navigate(1)}><span class="material-symbols-outlined">chevron_left</span></button>
          <button type="button" class="health-date-trigger" aria-label=${`Choose date, currently ${dayLabel(this._date)}`} aria-expanded=${String(this._pickerOpen)} aria-controls="health-date-popover" @click=${this._togglePicker}><span>${dayLabel(this._date)}</span><span class="material-symbols-outlined" aria-hidden="true">calendar_month</span></button>
          <button type="button" aria-label="Next available day" ?disabled=${index <= 0} @click=${() => this._navigate(-1)}><span class="material-symbols-outlined">chevron_right</span></button>
        </div>${this._pickerOpen ? this._datePicker() : nothing}</div>` : nothing}
      </header>

      ${this._error ? html`<div class="health-message" role="alert">${this._error} <button type="button" @click=${this._load}>Try again</button></div>` : nothing}
      ${this._loading ? html`<div class="health-message">Loading health data…</div>` : nothing}
      ${!this._loading && !this._dates.length && !this._error ? html`<section class="health-empty"><h2>No health data yet</h2><p>Download Garmin wellness data into <code>data/wellness</code> to see daily metrics and trends here.</p></section>` : nothing}

      ${day ? html`
        <section class="health-section" aria-label="Daily overview">
          <div class="health-section-heading"><h2>Daily overview</h2><span>${shortDay(day.date)}</span></div>
          <div class="health-metrics">
            ${this._metric("Steps", number(day.steps), "", day.stepGoal != null ? html`<div class="health-progress"><span style=${`width:${goalPercent}%`}></span></div><span>${number(day.stepGoal)} goal · ${Math.round(goalPercent)}%</span>` : "No goal recorded", "featured")}
            ${this._metric("Body Battery", number(day.bodyBattery), "/ 100", day.bodyBatteryHigh != null && day.bodyBatteryLow != null ? `${number(day.bodyBatteryLow)} low · ${number(day.bodyBatteryHigh)} high` : "No range recorded", "featured")}
            ${this._metric("Resting heart rate", number(day.restingHeartRate), "bpm", "Daily resting value")}
            ${this._metric("Average stress", number(day.averageStress), "/ 100", "Daily average")}
          </div>
          <div class="health-extras">
            <div><span>Sleep</span><strong>${duration(day.sleepSeconds)}</strong></div>
            <div><span>Overnight HRV</span><strong>${number(day.overnightHrv)}${day.overnightHrv == null ? "" : " ms"}</strong></div>
            <div><span>Active calories</span><strong>${number(day.activeCalories)}${day.activeCalories == null ? "" : " kcal"}</strong></div>
            <div><span>Intensity minutes</span><strong>${day.moderateIntensityMinutes == null && day.vigorousIntensityMinutes == null ? "—" : `${number(day.moderateIntensityMinutes)} moderate · ${number(day.vigorousIntensityMinutes)} vigorous`}</strong></div>
            <div><span>Average Pulse Ox</span><strong>${number(day.averageSpO2)}${day.averageSpO2 == null ? "" : "%"}</strong></div>
            <div><span>Waking respiration</span><strong>${number(day.wakingRespiration)}${day.wakingRespiration == null ? "" : " brpm"}</strong></div>
          </div>
        </section>

        <section class="health-section" aria-label="Trends">
          <div class="health-section-heading health-trends-heading"><div><h2>Trends</h2><p>${availableTrendDays} of ${this._period} days have saved data. ${grouping} bars ${Number(this._period) > 30 ? "show the daily average of recorded days" : "show daily values"}; select a bar to inspect ${Number(this._period) > 30 ? "its latest saved day" : "that day"}.</p></div>
            <custom-select aria-label="Trend period" .value=${this._period} .items=${periodOptions} @change=${this._changePeriod}></custom-select>
          </div>
          <div class="health-charts">${this._trendDays.length ? trends.filter((config) => this._trendDays.some((row) => row[config.key] != null)).map((config) => this._chart(config, buckets)) : nothing}</div>
        </section>
        <p class="health-note">A dash means Garmin did not provide that measurement for this day. Trends end on the selected date.</p>
      ` : nothing}
    `;
  }
}

customElements.define("health-page", HealthPage);
