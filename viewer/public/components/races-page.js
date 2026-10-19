import { LitElement, html, nothing } from 'lit';
import { berlinDay, raceDate, raceDates, countdown, number, raceTime } from './race-utils.js';
import './custom-select.js';

class RacesPage extends LitElement {
  static properties = { _data: { state: true }, _error: { state: true }, _dialogError: { state: true }, _busy: { state: true }, _year: { state: true }, _archived: { state: true }, _distance: { state: true }, _mode: { state: true }, _race: { state: true }, _activities: { state: true } };
  constructor() {
    super();
    const p = new URLSearchParams(location.search), year = Number(p.get('year'));
    this._year = year >= 1900 && year <= 2200 ? year : Number(berlinDay(new Date()).slice(0, 4));
    this._data = null; this._error = ''; this._dialogError = ''; this._busy = false; this._archived = false; this._distance = 'all'; this._mode = ''; this._race = null; this._activities = [];
    this._refresh = () => { if (!this._mode) this._load(); };
  }
  createRenderRoot() { return this; }
  connectedCallback() { super.connectedCallback(); window.addEventListener('focus', this._refresh); this._load(true); }
  disconnectedCallback() { super.disconnectedCallback(); window.removeEventListener('focus', this._refresh); this._request?.abort(); }
  async _load(initial = false) {
    this._request?.abort(); const request = new AbortController(); this._request = request;
    try {
      const r = await fetch(`/api/races?year=${this._year}`, { signal: request.signal }); const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load races.');
      this._data = d; this._error = '';
      if (initial) {
        const p = new URLSearchParams(location.search);
        if (!p.has('year') && !p.has('race') && !p.has('add') && !d.races.some(r => !r.archived) && d.nextRace && Number(d.nextRace.startDate.slice(0, 4)) !== this._year) {
          this._year = Number(d.nextRace.startDate.slice(0, 4));
          history.replaceState(null, '', `/races?year=${this._year}`);
          await this._load(); return;
        }
        if (p.has('add')) this._open(null, 'edit', p.get('date'));
        else if (p.get('race')) { const all = await this._json('/api/races'); const race = all.races.find(r => r.id === p.get('race')); if (race) this._open(race, 'details'); }
      }
    } catch (e) { if (e.name !== 'AbortError') this._error = e.message; }
  }
  async _json(url, method, body) {
    const response = await fetch(url, method ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save races.'); return data;
  }
  async _action(task, close = false) {
    if (this._busy) return;
    this._busy = true; this._dialogError = ''; this._error = '';
    try { await task(); if (close) { this.querySelector('dialog')?.close(); this._closed(); } await this._load(); }
    catch (e) { if (this._mode) this._dialogError = e.message; else this._error = e.message; }
    finally { this._busy = false; }
  }
  async _open(race = null, mode = 'edit', date = null) {
    this._returnFocus = document.activeElement;
    this._race = race || { startDate: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : `${this._year}-01-01`, endDate: '', distanceMeters: 10000, dateConfirmed: true, outcome: 'planned', registrationStatus: 'interested' };
    this._mode = mode; this._dialogError = ''; await this.updateComplete;
    this.querySelector('dialog').showModal();
    if (mode === 'edit') this._loadActivities();
  }
  async _loadActivities() {
    try { const d = await this._json('/api/activities?type=running'); this._activities = d.activities.filter(a => berlinDay(a.time) && berlinDay(a.time) <= this._data.today).sort((a, b) => new Date(b.time) - new Date(a.time)); }
    catch { this._dialogError = 'Could not load activities. You can still save without changing the activity link.'; }
  }
  _close() { if (this._busy) return; this.querySelector('dialog')?.close(); this._closed(); }
  _closed() { this._mode = ''; this._dialogError = ''; if (this._returnFocus?.isConnected) this._returnFocus.focus(); }
  _yearChanged(e) { this._year = Number(e.target.value); history.replaceState(null, '', `/races?year=${this._year}`); this._load(); }
  _formData(form) {
    const data = new FormData(form);
    for (const select of form.querySelectorAll('custom-select[name]')) data.set(select.getAttribute('name'), select.value);
    return data;
  }
  _save(e) {
    e.preventDefault(); const f = this._formData(e.currentTarget), race = this._race;
    const rawTime = f.get('targetTime').trim(); let seconds = null;
    if (rawTime) {
      if (!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(rawTime)) { this._dialogError = 'Use hours:minutes:seconds, for example 1:45:00.'; return; }
      const [h, m, s] = rawTime.split(':').map(Number); seconds = h * 3600 + m * 60 + s;
    }
    const body = { name: f.get('name'), startDate: f.get('startDate'), endDate: f.get('endDate') || f.get('startDate'), dateConfirmed: f.has('dateConfirmed'), distanceMeters: Math.round(Number(f.get('distanceKm')) * 1000), location: f.get('location'), website: f.get('website'), notes: f.get('notes'), targetTimeSeconds: seconds, registrationStatus: f.get('registrationStatus'), outcome: f.get('outcome'), activityId: f.get('activityId') || null };
    this._action(async () => { const saved = await this._json(race.id ? `/api/races/${race.id}` : '/api/races', race.id ? 'PUT' : 'POST', body); this._year = Number(saved.startDate.slice(0, 4)); history.replaceState(null, '', `/races?year=${this._year}`); }, true);
  }
  _target(id) { this._action(() => this._json('/api/races/settings', 'PUT', { targetRaceId: id })); }
  _archive(race) { this._action(() => this._json(`/api/races/${race.id}`, 'PUT', { archived: !race.archived }), true); }
  _saveSettings(e) {
    e.preventDefault(); const f = this._formData(e.currentTarget);
    this._action(() => this._json('/api/races/settings', 'PUT', { targetRaceId: f.get('targetRaceId') || null, runDays: Number(f.get('runDays')), weeklyDistanceKm: f.get('weeklyDistanceKm') === '' ? null : Number(f.get('weeklyDistanceKm')) }), true);
  }
  async _settings() { this._allRaces = (await this._json('/api/races')).races; this._open(null, 'settings'); }
  async _templates() { this._template = await this._json('/api/races/templates/berlin-2027'); this._open(null, 'templates'); }
  _importTemplate() { this._action(async () => { await this._json('/api/races/templates/berlin-2027', 'POST', {}); this._year = 2027; history.replaceState(null, '', '/races?year=2027'); }, true); }
  _templateForm() {
    return html`<p>Six optional starting points from Running Season 2027. Edit your distance and registration status after adding them. Existing entries from this set are kept.</p><p class="race-muted">Dates checked ${raceDate(this._template.checkedAt)}. The Tierparklauf remains a tentative weekend until you confirm your competition day.</p>${this._template.races.map(r => html`<p><strong>${r.name}</strong><br>${raceDates({ ...r, endDate: r.endDate || r.startDate, dateConfirmed: r.dateConfirmed !== false })} · ${number(r.distanceMeters / 1000)} km · <a href=${r.website} target="_blank" rel="noopener noreferrer">Organiser ↗</a></p>`)}<button class="primary" ?disabled=${this._busy} @click=${this._importTemplate}>Add Berlin 2027 races</button>`;
  }
  _timeline(races) {
    if (!races.length) return nothing;
    const firstDay = races.reduce((s, r) => r.phases[0].start < s ? r.phases[0].start : s, races[0].phases[0].start);
    const lastDay = races.reduce((s, r) => r.endDate > s ? r.endDate : s, races[0].endDate);
    const start = firstDay.slice(0, 7) + '-01';
    const lastMonth = new Date(lastDay.slice(0, 7) + '-01T00:00:00Z');
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() + 1);
    const end = lastMonth.toISOString().slice(0, 10);
    const span = Date.parse(end) - Date.parse(start), position = d => (Date.parse(d) - Date.parse(start)) / span * 100;
    const months = []; const month = new Date(start + 'T00:00:00Z');
    while (month.toISOString().slice(0, 10) < end) {
      const day = month.toISOString().slice(0, 10);
      const label = month.toLocaleDateString('en-GB', { month: 'short', ...(months.length === 0 || month.getUTCMonth() === 0 ? { year: '2-digit' } : {}), timeZone: 'UTC' });
      month.setUTCMonth(month.getUTCMonth() + 1);
      months.push({ day, label, width: position(month.toISOString().slice(0, 10)) - position(day) });
    }
    const dateLabel = r => {
      const compact = day => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
      return r.startDate === r.endDate ? compact(r.startDate) : r.startDate.slice(0, 7) === r.endDate.slice(0, 7) ? `${r.startDate.slice(8, 10)}–${compact(r.endDate)}` : `${compact(r.startDate)}–${compact(r.endDate)}`;
    };
    return html`<section class="race-panel race-season"><div class="race-season-heading"><h2>Season ${this._year}</h2><span class="race-season-count">${races.length} ${races.length === 1 ? 'race' : 'races'}</span></div><p class="race-muted race-season-intro">Explore each race and its preparation windows. ✳ marks your training target.</p><div class="race-timeline-scroll"><div class="race-timeline"><div class="race-timeline-row race-timeline-header"><span>Races</span><div class="race-lane race-axis">${months.map(m => html`<span style=${`left:${position(m.day)}%;width:${m.width}%`}>${m.label}</span>`)}</div></div>
      ${races.map((r, i) => html`<div class=${`race-timeline-row ${r.id === this._data.settings.targetRaceId ? 'is-selected' : ''}`}><button class="race-label" @click=${() => this._open(r, 'details')}><span class="race-row-number">${String(i + 1).padStart(2, '0')}</span><span class="race-row-name">${r.name}</span>${r.id === this._data.settings.targetRaceId ? html`<span class="race-target-star" aria-label="Training target">✳</span>` : nothing}</button><div class="race-lane">
        ${months.map(m => html`<span class="race-month-line" style=${`left:${position(m.day)}%`}></span>`)}
        ${r.phases.map(p => html`<button class=${`race-phase ${p.key}`} style=${`left:${position(p.start)}%;width:${position(p.end) - position(p.start)}%`} title=${`${r.name}: ${p.name} · ${raceDate(p.start)} – ${raceDate(p.end)}${r.dateConfirmed ? '' : ' (tentative)'}`} aria-label=${`${r.name}: ${p.name}, ${raceDate(p.start)} – ${raceDate(p.end)}`} @click=${() => this._open(r, 'details')}></button>`)}
        ${this._data.today >= start && this._data.today <= end ? html`<span class="race-today-line" style=${`left:${position(this._data.today)}%`} title="Today"></span>` : nothing}
        <button class="race-marker" style=${`left:${position(r.startDate)}%`} title=${raceDates(r)} aria-label=${`${r.name}, ${raceDates(r)}`} @click=${() => this._open(r, 'details')}></button><span class=${`race-marker-date ${position(r.startDate) > 96 ? 'near-edge' : ''}`} style=${`left:${position(r.startDate)}%`}>${dateLabel(r)}${r.dateConfirmed ? '' : '*'}</span></div></div>`)}</div></div><div class="race-legend">${['Base', 'Build', 'Race-specific', 'Taper'].map((p, i) => html`<span><i class=${['base', 'build', 'specific', 'taper'][i]}></i>${p}</span>`)}<span><i class="race-day-swatch"></i>Race day</span></div><p class="race-chart-note">Alternative preparation windows. Overlapping blocks are never added together.${races.some(r => !r.dateConfirmed) ? ' * Tentative date or event weekend.' : ''}</p></section>`;
  }
  _stats() {
    const { stats: s, nextRace: next } = this._data;
    return html`<div class="race-stats"><section class="race-panel"><span class="race-eyebrow">Next race</span>${next ? html`<h2><a href=${`/races?year=${next.startDate.slice(0, 4)}&race=${next.id}`}>${next.name}</a></h2><p>${raceDates(next)}</p><strong class="race-number">${countdown(next)}</strong>` : html`<h2>Your next start</h2><p>No upcoming races. Add one to start planning.</p>`}</section>
      <section class="race-panel"><span class="race-eyebrow">4-week average</span><strong class="race-number">${s.available ? number(s.averageKm) : '—'} <small>km / week</small></strong><p class="race-muted">${raceDate(s.start)} – ${raceDate(s.end)}</p><div class="race-spark" aria-label="Running distance over eight complete weeks">${s.series.map(w => html`<div title=${`${raceDate(w.start)}: ${number(w.km)} km, ${w.count} runs`}><span style=${`height:${Math.max(2, w.km / Math.max(1, ...s.series.map(v => v.km)) * 38)}px`}></span></div>`)}</div></section>
      <section class="race-panel"><span class="race-eyebrow">Last complete week</span><strong class="race-number">${s.available ? number(s.lastWeek.km) : '—'} <small>km · ${s.lastWeek.count} runs</small></strong><p class="race-muted">${raceDate(s.lastWeek.start)} – ${raceDate(s.end)}</p><p>Longest run in 4 weeks: ${s.available ? number(s.longestKm) : '—'} km</p>${s.missingDistances ? html`<p class="race-muted">${s.missingDistances} runs without distance are excluded from kilometre totals.</p>` : nothing}</section></div>`;
  }
  _training() {
    const d = this._data;
    return html`<div class="race-training"><section class="race-panel"><span class="race-eyebrow">Training target</span><h2>${d.target?.name || 'Choose your focus'}</h2>${d.target ? html`<p>${countdown(d.target)} · ${number(d.target.distanceMeters / 1000)} km</p><h3>${d.phase}${!d.target.dateConfirmed ? ' · tentative dates' : ''}</h3><p class="race-muted">${d.phase === 'Taper' ? 'Reduced volume before your race. Keep the runs easy.' : 'Build a consistent rhythm with easy runs and recovery days. No pace or target time is inferred from your activities.'}</p>${d.conflicts.map(r => html`<p class="race-callout">${r.name}: ${Math.abs(r.days)} days ${r.days < 0 ? 'before' : 'after'} your target. Choose where to focus your effort and allow recovery.</p>`)}` : html`<p class="race-muted">Select an upcoming race as your training target. A past target is kept in your history.</p>`}<button @click=${() => this._settings().catch(e => { this._error = e.message; })}>Planning settings</button></section>
      <section class="race-panel"><span class="race-eyebrow">Weekly suggestion</span><h2>${d.sessions.length ? `${number(d.sessions.reduce((n, s) => n + s.km, 0))} km · ${d.settings.runDays} run days` : 'Set your training rhythm'}</h2><p class="race-muted">${d.settings.weeklyDistanceKm == null ? 'Based on your last complete running week' : 'Based on your chosen weekly distance'}${d.phase === 'Taper' ? ' · 65% taper volume' : ''}</p>
      ${d.sessions.map(s => html`<div class="race-session"><span>${s.day}</span><strong>${s.title}</strong><span>${number(s.km)} km</span></div>`)}<p class="race-muted">${d.sessions.length ? 'Example distribution, without automatic mileage increases. Change your volume and run days in Planning settings.' : 'Choose a future training target and a weekly distance to see a suggestion. No sessions are suggested on race day.'}</p></section></div>`;
  }
  _card(r) {
    const target = r.id === this._data.settings.targetRaceId;
    return html`<article class=${`race-panel race-card ${target ? 'chosen' : ''}`}><div class="race-card-meta"><span>${raceDates(r)}</span><strong>${number(r.distanceMeters / 1000)} km</strong></div><h3><button class="race-title" @click=${() => this._open(r, 'details')}>${r.name}</button></h3><p class="race-muted">${r.location || 'Location not set'} · ${r.registrationStatus === 'registered' ? 'Registered' : 'Interested'}</p><p>${r.outcome === 'planned' ? countdown(r) : r.outcome.toUpperCase()}${target ? ' · ✳ Training target' : ''}</p>${r.targetTimeSeconds ? html`<p>Target time ${raceTime(r.targetTimeSeconds)}</p>` : nothing}
      ${r.activityId ? r.result ? html`<p>Result: <a href=${`/activity/${encodeURIComponent(r.activityId)}`}>${number(r.result.distance / 1000)} km · ${raceTime(r.result.timerDuration ?? r.result.duration)}</a></p>` : html`<p class="race-callout">Linked activity is currently unavailable.</p>` : nothing}
      <div class="race-actions"><button @click=${() => this._open(r)}>Edit</button>${!r.archived && r.outcome === 'planned' && r.endDate >= this._data.today ? html`<button ?disabled=${this._busy} @click=${() => this._target(target ? null : r.id)}>${target ? 'Clear target' : 'Set as training target'}</button>` : nothing}${r.website ? html`<a href=${r.website} target="_blank" rel="noopener noreferrer">Organiser ↗</a>` : nothing}</div></article>`;
  }
  _editForm() {
    const r = this._race;
    return html`<form @submit=${this._save}><div class="race-fields">
      <label class="wide">Name<input name="name" required maxlength="160" .value=${r.name || ''}></label>
      <label>Race date / window start<input name="startDate" type="date" required min="1900-01-01" max="2200-12-31" .value=${r.startDate}></label><label>Window end (optional)<input name="endDate" type="date" min="1900-01-01" max="2200-12-31" .value=${r.endDate === r.startDate ? '' : r.endDate || ''}></label>
      <label class="wide race-checkbox"><input name="dateConfirmed" type="checkbox" .checked=${r.dateConfirmed}>Exact date confirmed (a multi-day window stays tentative)</label>
      <label>Distance (km)<input name="distanceKm" type="number" list="race-distances" required min="0.001" max="1000" step="0.001" .value=${String(r.distanceMeters / 1000)}><datalist id="race-distances"><option value="5"></option><option value="10"></option><option value="21.097"></option><option value="25"></option><option value="42.195"></option></datalist></label><label>Target time (h:mm:ss)<input name="targetTime" placeholder="1:45:00" .value=${r.targetTimeSeconds ? raceTime(r.targetTimeSeconds) : ''}></label>
      <label>Location<input name="location" maxlength="200" .value=${r.location || ''}></label><label>Organiser website<input name="website" type="url" maxlength="2000" .value=${r.website || ''}></label>
      <label>Registration<custom-select name="registrationStatus" aria-label="Registration" .value=${r.registrationStatus} .items=${[{value:'interested',label:'Interested'},{value:'registered',label:'Registered'}]}></custom-select></label>
      <label>Race status<custom-select name="outcome" aria-label="Race status" .value=${r.outcome} .items=${[['planned', 'Planned'], ['finished', 'Finished'], ['dns', 'Did not start'], ['dnf', 'Did not finish'], ['cancelled', 'Cancelled']].map(([value, label]) => ({value,label}))}></custom-select></label>
      <label class="wide">Completed running activity (optional)<custom-select name="activityId" aria-label="Completed running activity (optional)" .value=${r.activityId || ''} .items=${[{value:'',label:'No linked activity'},...(r.activityId && !this._activities.some(a => a.id === r.activityId) ? [{value:r.activityId,label:`Keep current link · ${r.activityId}`}] : []),...this._activities.map(a => ({value:a.id,label:`${raceDate(berlinDay(a.time))} · ${a.name}`}))]}></custom-select></label>
      <label class="wide">Notes<textarea name="notes" maxlength="4000" rows="3" .value=${r.notes || ''}></textarea></label>
      </div><p class="race-muted">Planning is saved separately from your activities. Linking a run does not mark a race as finished automatically.</p><div class="race-actions"><button class="primary" type="submit" ?disabled=${this._busy}>${this._busy ? 'Saving…' : 'Save race'}</button>${r.id ? html`<button type="button" ?disabled=${this._busy} @click=${() => this._archive(r)}>${r.archived ? 'Restore race' : 'Archive race'}</button>` : nothing}<button type="button" ?disabled=${this._busy} @click=${this._close}>Cancel</button></div></form>`;
  }
  _settingsForm() {
    const s = this._data.settings;
    return html`<form @submit=${this._saveSettings}><div class="race-fields"><label class="wide">Training target<custom-select name="targetRaceId" aria-label="Training target" .value=${s.targetRaceId || ''} .items=${[{value:'',label:'No training target'},...(this._allRaces || []).filter(r => !r.archived && r.outcome === 'planned' && r.endDate >= this._data.today).map(r => ({value:r.id,label:`${r.name} · ${raceDates(r)}`}))]}></custom-select></label><label>Weekly distance (km)<input name="weeklyDistanceKm" type="number" min="0.1" step="0.1" max="1000" placeholder="Use last complete week" .value=${s.weeklyDistanceKm == null ? '' : String(s.weeklyDistanceKm)}></label><label>Run days<custom-select name="runDays" aria-label="Run days" .value=${String(s.runDays)} .items=${[2,3,4,5].map(n => ({value:String(n),label:`${n} days`}))}></custom-select></label></div><p class="race-muted">Leave distance empty to use your latest complete running week. These settings are saved on your Traverse server.</p><button class="primary" ?disabled=${this._busy}>Save settings</button></form>`;
  }
  _details() {
    const r = this._race;
    return html`${this._card(r)}${r.notes ? html`<p class="race-notes">${r.notes}</p>` : nothing}<h3>Preparation windows${r.dateConfirmed ? '' : ' · tentative'}</h3>${r.phases.map(p => html`<p>${p.name}: ${raceDate(p.start)} – ${raceDate(p.end)}</p>`)}<p class="race-muted">General planning orientation, based on the race distance and date.</p><button @click=${async () => { this._mode = 'edit'; await this.updateComplete; this._loadActivities(); }}>Edit race</button>`;
  }
  render() {
    const d = this._data;
    const races = d?.races.filter(r => r.archived === this._archived && (this._distance === 'all' || (this._distance === 'short' ? r.distanceMeters <= 10000 : r.distanceMeters > 10000))) || [];
    return html`<header class="race-heading"><div><h1>Races</h1><p>Your season, your next start, your training focus.</p></div><div class="race-actions"><button @click=${() => this._load()}>Refresh</button><button ?disabled=${!d || this._busy} @click=${() => this._templates().catch(e => { this._error = e.message; })}>Berlin 2027 ideas</button><button class="primary" ?disabled=${!d || this._busy} @click=${() => this._open()}>Add race</button></div></header>
      ${this._error ? html`<div class="race-error" role="alert">${this._error} <button @click=${() => this._load()}>Try again</button></div>` : nothing}
      ${d ? html`${this._stats()}<div class="race-toolbar"><label>Season <custom-select aria-label="Season" .value=${String(this._year)} @change=${this._yearChanged} .items=${[...new Set([...d.years, this._year - 1, this._year + 1])].filter(y => y >= 1900 && y <= 2200).sort((a, b) => a - b).map(y => ({value:String(y),label:String(y)}))}></custom-select></label><label>Distance <custom-select aria-label="Distance" .value=${this._distance} @change=${e => { this._distance = e.target.value; }} .items=${[{value:"all",label:"All distances"},{value:"short",label:"Up to 10 km"},{value:"long",label:"Over 10 km"}]}></custom-select></label><label class="race-checkbox"><input type="checkbox" .checked=${this._archived} @change=${e => { this._archived = e.target.checked; }}>Archived</label><a href=${`/api/races/calendar.ics?year=${this._year}`}>Export calendar</a></div>${!this._archived ? this._timeline(races.filter(r => r.outcome !== 'cancelled')) : nothing}${this._training()}<section><h2>${this._archived ? 'Archived races' : `Races · ${this._year}`}</h2>${races.length ? html`<div class="race-grid">${races.map(r => this._card(r))}</div>` : html`<div class="race-panel"><h3>No races here yet</h3><p>Add your own race, or choose a different season or filter.</p><button @click=${() => this._open()}>Add race</button></div>`}</section><p class="race-muted race-footnote">Running statistics use complete Monday–Sunday weeks in Europe/Berlin. ${d.stats.latestActivity ? `Latest indexed activity: ${raceDate(berlinDay(d.stats.latestActivity))}.` : 'No activity data available.'} Preparation windows are alternative plans; overlapping volume is never added.</p>` : html`<p role="status">${this._error ? 'Race data is unavailable.' : 'Loading your season…'}</p>`}
      <dialog class="race-dialog" aria-labelledby="race-dialog-title" @cancel=${e => { if (this._busy) e.preventDefault(); }} @close=${this._closed}><div class="race-dialog-heading"><h2 id="race-dialog-title">${this._mode === 'templates' ? 'Berlin 2027 ideas' : this._mode === 'settings' ? 'Planning settings' : this._mode === 'details' ? 'Race details' : this._race?.id ? 'Edit race' : 'Add race'}</h2><button aria-label="Close dialog" ?disabled=${this._busy} @click=${this._close}>×</button></div>${this._dialogError ? html`<p class="race-error" role="alert">${this._dialogError}</p>` : nothing}${this._mode === 'templates' ? this._templateForm() : this._mode === 'edit' ? this._editForm() : this._mode === 'settings' ? this._settingsForm() : this._mode === 'details' ? this._details() : nothing}</dialog>`;
  }
}
customElements.define('races-page', RacesPage);
