import { LitElement, html, nothing } from 'lit';
import './custom-select.js';
import { repeat } from 'https://esm.sh/lit@3/directives/repeat.js';
import { formatType, formatDistance, formatDuration } from './utils.js';

const metricLabels = { duration: 'Training time', distance: 'Total distance', count: 'Activity count', longest: 'Longest activity', manual: 'Manual benchmark', milestones: 'Skill milestones' };
const unitLabels = { duration: 'hours', distance: 'km', count: 'sessions', longest: 'km' };
const fmt = number => number == null ? '—' : Number(number).toLocaleString('en-GB', { maximumFractionDigits: 1 });
const dateLabel = date => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
const berlinFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
const berlinDay = value => { const parts = berlinFormatter.formatToParts(new Date(value)); return ['year', 'month', 'day'].map(t => parts.find(p => p.type === t).value).join('-'); };
const today = () => berlinDay(new Date());

class GoalsPage extends LitElement {
  static properties = { _data: { state: true }, _error: { state: true }, _busy: { state: true }, _group: { state: true }, _category: { state: true }, _archived: { state: true }, _mode: { state: true }, _goal: { state: true }, _draft: { state: true }, _dialogError: { state: true }, _notice: { state: true }, _activities: { state: true }, _categoryToRemove: { state: true }, _reassignTo: { state: true } };
  createRenderRoot() { return this; }
  constructor() {
    super(); this._data = null; this._error = ''; this._busy = false; this._group = ''; this._category = ''; this._archived = false; this._mode = ''; this._goal = null; this._draft = {}; this._dialogError = ''; this._notice = ''; this._activities = []; this._categoryToRemove = ''; this._reassignTo = '';
  }
  connectedCallback() { super.connectedCallback(); this._load(); }
  disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this._noticeTimer); }
  async _api(path = '', method = 'GET', body = undefined) {
    const response = await fetch('/api/goals' + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data; try { data = await response.json(); } catch { throw new Error('Could not connect to Goals. Please try again.'); }
    if (!response.ok) throw new Error(data.error || 'Could not save this change.'); return data;
  }
  async _load() { try { this._data = await this._api(); this._error = ''; } catch (e) { this._error = e.message; } }
  _notify(message) { this._notice = message; clearTimeout(this._noticeTimer); this._noticeTimer = setTimeout(() => { this._notice = ''; }, 4500); }
  updated() {
    const dialog = this.querySelector('dialog');
    if (this._mode && dialog && !dialog.open) { this._returnFocus = document.activeElement; dialog.showModal(); }
    if (!this._mode && dialog?.open) { dialog.close(); this._returnFocus?.isConnected && this._returnFocus.focus(); }
  }
  _close() { this._mode = ''; this._dialogError = ''; this._categoryToRemove = ''; }
  _openGoal(goal = null, category = '') {
    this._goal = goal; this._dialogError = ''; this._mode = 'goal';
    this._draft = goal ? { ...goal, milestones: goal.milestones.map(m => ({ ...m })) } : { title: '', category: category || this._category || this._data.categories[0]?.id, metric: 'duration', target: '', unit: 'reps', baseline: '', group: this._group || '', period: 'weekly', startDate: today(), endDate: `${Number(today().slice(0, 4)) + 1}-01-31`, activityTypes: [], milestones: [] };
  }
  _capture(form) {
    const data = Object.fromEntries(new FormData(form));
    for (const select of form.querySelectorAll('custom-select[name]')) data[select.getAttribute('name')] = select.value;
    if (form.querySelector('.goal-milestone-editor')) data.milestones = [...form.querySelectorAll('input[name="milestone"]')].map(input => ({id:input.dataset.milestoneId,label:input.value}));
    data.activityTypes = [...form.querySelectorAll('input[name="activityType"]:checked')].map(x => x.value);
    return data;
  }
  _metricChanged(e) {
    const values = this._capture(e.target.closest('form')); this._draft = { ...this._draft, ...values };
    if (values.metric === 'milestones' && !this._draft.milestones?.length) this._draft = { ...this._draft, milestones: [{id:crypto.randomUUID(),label:''}] };
    if (['manual', 'milestones'].includes(values.metric)) this._draft = { ...this._draft, period: 'range' };
  }
  async _addMilestone(position) {
    const values = this._capture(this.querySelector('.goals-form'));
    const milestones = [...(values.milestones || [])];
    if (milestones.length >= 20) return;
    const id = crypto.randomUUID();
    milestones.splice(position ?? milestones.length, 0, {id,label:''});
    this._draft = { ...this._draft, ...values, milestones };
    await this.updateComplete;
    this.querySelector(`input[data-milestone-id="${id}"]`)?.focus();
  }
  async _removeMilestone(id) {
    const values = this._capture(this.querySelector('.goals-form'));
    if (values.milestones.length < 2) return;
    const position = values.milestones.findIndex(m => m.id === id);
    const milestones = values.milestones.filter(m => m.id !== id);
    this._draft = { ...this._draft, ...values, milestones };
    await this.updateComplete;
    const next = milestones[Math.min(position, milestones.length - 1)];
    this.querySelector(`input[data-milestone-id="${next.id}"]`)?.focus();
  }
  _milestoneEditor() {
    const milestones = this._draft.milestones || [];
    return html`<fieldset class="goal-milestone-editor"><legend>Milestones</legend><div class="goal-milestone-rows">
      ${repeat(milestones, m => m.id, (m, i) => html`<div class="goal-milestone-row"><span class="goal-milestone-number" aria-hidden="true">${String(i + 1).padStart(2,'0')}</span><input name="milestone" data-milestone-id=${m.id} aria-label=${'Milestone ' + (i + 1)} .value=${m.label} required maxlength="120" placeholder="e.g. First muscle-up" ?disabled=${this._busy} @keydown=${e => {if(e.key === 'Enter'){e.preventDefault();this._addMilestone(i + 1);}}}><button type="button" class="goals-button goal-milestone-remove" aria-label=${'Remove milestone ' + (i + 1)} title="Remove milestone" ?disabled=${this._busy || milestones.length < 2} @click=${() => this._removeMilestone(m.id)}><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>`)}
      </div><div class="goal-milestone-actions"><button type="button" class="goals-button goal-milestone-add" ?disabled=${this._busy || milestones.length >= 20} @click=${() => this._addMilestone()}><span class="material-symbols-outlined" aria-hidden="true">add</span>Add milestone</button><small>${milestones.length} / 20</small></div></fieldset>`;
  }
  async _saveGoal(e) {
    e.preventDefault(); this._busy = true; this._dialogError = '';
    const values = this._capture(e.target); this._draft = { ...this._draft, ...values };
    const milestones = values.milestones || [];
    try { await this._api(this._goal ? '/' + this._goal.id : '', this._goal ? 'PUT' : 'POST', { ...values, milestones }); this._close(); await this._load(); this._notify('Goal saved.'); }
    catch (e) { this._dialogError = e.message; } finally { this._busy = false; }
  }
  async _archive() {
    this._busy = true; try { await this._api('/' + this._goal.id + '/archive', 'PATCH', { archived: !this._goal.archived }); this._close(); await this._load(); this._notify(this._goal.archived ? 'Goal restored.' : 'Goal archived. You can restore it from Archived.'); }
    catch (e) { this._dialogError = e.message; } finally { this._busy = false; }
  }
  async _starter() {
    this._busy = true; try { await this._api('/winter-arc', 'POST', { startDate: today() }); await this._load(); this._group = 'Winter Arc'; this._notify('Winter Arc goals added. Edit the suggested targets to fit your baseline.'); }
    catch (e) { this._error = e.message; } finally { this._busy = false; }
  }
  async _milestone(goal, milestone, e) {
    const checked = e.target.checked; this._busy = true;
    try { await this._api(`/${goal.id}/milestones/${milestone.id}`, 'PATCH', { checked }); await this._load(); }
    catch (error) { e.target.checked = !checked; this._notify(error.message); } finally { this._busy = false; }
  }
  async _openBenchmark(goal, entry = null) {
    this._goal = goal; this._entry = entry; this._draft = entry ? { ...entry } : { value: '', note: '', activityId: '', date: today() }; this._activities = []; this._dialogError = ''; this._mode = 'benchmark'; this._busy = true;
    try { const response = await fetch('/api/activities'); if (!response.ok) throw new Error('Could not load your Garmin activities.'); const data = await response.json(); this._activities = data.activities.filter(a => a.time && a.time.slice(0, 4)).filter(a => { const date = berlinDay(a.time); return date >= goal.startDate && date <= goal.endDate && date <= today(); }).sort((a, b) => new Date(b.time) - new Date(a.time)); }
    catch (e) { this._dialogError = e.message; } finally { this._busy = false; }
  }
  async _saveBenchmark(e) {
    e.preventDefault(); this._draft = { ...this._draft, ...this._capture(e.target) }; this._busy = true; this._dialogError = '';
    try { await this._api(`/${this._goal.id}/benchmarks${this._entry ? '/' + this._entry.id : ''}`, this._entry ? 'PUT' : 'POST', this._draft); this._close(); await this._load(); this._notify('Benchmark saved.'); }
    catch (e) { this._dialogError = e.message; } finally { this._busy = false; }
  }
  async _saveCategory(e, category = null) {
    e.preventDefault(); const name = new FormData(e.target).get('name'); this._busy = true; this._dialogError = '';
    try { await this._api(category ? '/categories/' + category.id : '/categories', category ? 'PUT' : 'POST', { name }); await this._load(); if (!category) e.target.reset(); this._notify('Category saved.'); }
    catch (e) { this._dialogError = e.message; } finally { this._busy = false; }
  }
  _startCategoryRemoval(category) {
    this._categoryToRemove = category.id; this._dialogError = '';
    this._reassignTo = this._data.categories.find(c => c.id !== category.id)?.id || '';
  }
  async _removeCategory(category) {
    this._busy = true; this._dialogError = '';
    try {
      await this._api('/categories/' + category.id + '/remove', 'POST', { moveTo: this._reassignTo });
      if (this._category === category.id) this._category = '';
      this._categoryToRemove = ''; await this._load(); this._notify('Category removed. Restore it from Removed categories.');
    } catch (e) { this._dialogError = e.message; } finally { this._busy = false; }
  }
  async _restoreCategory(category) {
    this._busy = true; this._dialogError = '';
    try { await this._api('/categories/' + category.id + '/restore', 'POST', {}); await this._load(); this._notify('Category restored.'); }
    catch (e) { this._dialogError = e.message; } finally { this._busy = false; }
  }
  _details(goal) { this._goal = goal; this._dialogError = ''; this._mode = 'details'; }
  _activityLink(id) { return (this._data.sourceUrl || '') + '/activity/' + encodeURIComponent(id); }
  _progressCard(goal) {
    const p = goal.progress, manual = goal.metric === 'manual', milestone = goal.metric === 'milestones';
    const status = { achieved: goal.period === 'weekly' ? 'Achieved this week' : 'Achieved', active: 'In progress', upcoming: 'Upcoming', ended: 'Period ended' }[p.status];
    return html`<article class="goal-card ${manual ? 'compact' : ''}">
      <p class="goal-label"><span>${goal.group || metricLabels[goal.metric]} · ${goal.period === 'weekly' ? 'Weekly' : metricLabels[goal.metric]}</span><span class="${p.status === 'achieved' ? 'achieved' : ''}">${goal.archived ? 'Archived' : status}</span></p>
      <div class="goal-title-row"><h3>${goal.title}</h3><div class="goal-number">${fmt(p.value)} <small>/ ${fmt(goal.target)} ${goal.unit}</small></div></div>
      <div class="goal-meter" role="progressbar" aria-label=${goal.title} aria-valuemin="0" aria-valuemax=${goal.target} aria-valuenow=${Math.min(p.value || 0, goal.target)}><span style="width:${p.percent}%"></span></div>
      ${milestone ? html`<div class="goal-checklist">${goal.milestones.map(m => html`<label><input type="checkbox" .checked=${!!m.achievedAt} ?disabled=${this._busy || goal.archived} @change=${e => this._milestone(goal, m, e)}><span>${m.label}</span></label>`)}</div>` : nothing}
      <p class="goal-description">${manual ? html`Best clean set · ${goal.baseline == null ? 'Baseline not set' : 'Baseline ' + fmt(goal.baseline) + ' ' + goal.unit} · ${p.entries.length} benchmarks` : milestone ? 'Mark milestones when you complete them.' : html`${p.activityCount} matching Garmin ${p.activityCount === 1 ? 'activity' : 'activities'} · ${dateLabel(p.start)}–${dateLabel(p.end)}`}</p>
      ${goal.activityTypes.some(t => t.startsWith('training:')) && this._data.unclassifiedTraining && !p.activityCount ? html`<p class="goal-description">Older Training activities have no detailed sport type. They are not included by these exact filters.</p>` : nothing}
      <div class="goal-footer"><small>${manual || milestone ? dateLabel(goal.startDate) + '–' + dateLabel(goal.endDate) : 'Garmin activity data'}</small><div>${manual && !goal.archived ? html`<button @click=${() => this._openBenchmark(goal)}>Add benchmark</button>` : nothing}<button @click=${() => this._details(goal)}>Details</button><button @click=${() => this._openGoal(goal)}>Edit</button></div></div>
    </article>`;
  }
  _editor() {
    const d = this._draft, manual = d.metric === 'manual', milestones = d.metric === 'milestones';
    return html`<form class="goals-form" @submit=${this._saveGoal}>
      <label>Title<input name="title" .value=${d.title || ''} required maxlength="100" placeholder="e.g. A 100 km ride"></label>
      <div class="form-grid"><label>Category<custom-select name="category" aria-label="Category" .value=${d.category || ''} .items=${this._data.categories.map(c => ({value:c.id,label:c.name}))}></custom-select></label><label>Group (optional)<input name="group" .value=${d.group || ''} maxlength="60" placeholder="e.g. Winter Arc"></label></div>
      <div class="form-grid"><label>Measurement<custom-select name="metric" aria-label="Measurement" .value=${d.metric} .items=${Object.entries(metricLabels).map(([value,label]) => ({value,label}))} @change=${this._metricChanged}></custom-select></label><label>Period<custom-select name="period" aria-label="Period" .value=${d.period} .items=${[...(!manual && !milestones ? [{value:'weekly',label:'Every week'}] : []),{value:'range',label:'Whole date range'}]}></custom-select></label></div>
      ${milestones ? this._milestoneEditor() : html`<div class="form-grid"><label>Target (${manual ? d.unit || 'reps' : unitLabels[d.metric]})<input type="number" name="target" .value=${String(d.target ?? '')} min=${d.metric === 'count' ? '1' : '0.01'} max="1000000000" step=${d.metric === 'count' ? '1' : 'any'} required></label>${manual ? html`<label>Unit<input name="unit" .value=${d.unit || 'reps'} required maxlength="20"></label>` : nothing}</div>`}
      ${manual ? html`<label>Baseline (optional)<input type="number" name="baseline" .value=${String(d.baseline ?? '')} min="0" max="1000000000" step="any"></label><p class="helper">Benchmarks are extra measurements. Linking a Garmin activity is optional.</p>` : nothing}
      <div class="form-grid"><label>Start date<input type="date" name="startDate" .value=${d.startDate} required></label><label>End date<input type="date" name="endDate" .value=${d.endDate} required></label></div>
      ${!manual && !milestones ? html`<fieldset><legend>Garmin activity types</legend><div class="type-options">${this._data.activityTypes.map(t => html`<label><input type="checkbox" name="activityType" value=${t.value} .checked=${(d.activityTypes || []).includes(t.value)}><span>${t.label}</span></label>`)}</div></fieldset><p class="helper">Training can include several sports. Specific filters use the detailed FIT sport type. Training time uses timer duration where available, otherwise elapsed duration.</p>` : nothing}
      ${this._dialogError ? html`<p class="goals-error" role="alert">${this._dialogError}</p>` : nothing}
      <div class="goals-form-footer">${this._goal ? html`<button type="button" class="goals-button archive" ?disabled=${this._busy} @click=${this._archive}>${this._goal.archived ? 'Restore' : 'Archive'}</button>` : nothing}<button type="button" class="goals-button" ?disabled=${this._busy} @click=${this._close}>Cancel</button><button class="goals-button primary" ?disabled=${this._busy}>${this._busy ? 'Saving…' : 'Save goal'}</button></div>
    </form>`;
  }
  _benchmarkActivityChanged(e) {
    this._draft = { ...this._draft, ...this._capture(e.target.closest('form')) };
    const activity = this._activities.find(a => a.id === this._draft.activityId);
    if (activity) this._draft = { ...this._draft, date: berlinDay(activity.time) };
  }
  _benchmarkEditor() {
    return html`<form class="goals-form" @submit=${this._saveBenchmark}>
      <p class="helper">Record your best clean set for ${this._goal.title}. You can optionally link a Garmin activity.</p>
      <div class="form-grid"><label>Date<input type="date" name="date" .value=${this._draft.date || today()} min=${this._goal.startDate} max=${this._goal.endDate < today() ? this._goal.endDate : today()} ?disabled=${!!this._draft.activityId} required></label><label>Value (${this._goal.unit})<input type="number" name="value" .value=${String(this._draft.value ?? '')} min="0" max="1000000000" step="any" required></label></div>
      <label>Garmin activity (optional)<custom-select name="activityId" aria-label="Garmin activity (optional)" .value=${this._draft.activityId || ''} .items=${[{value:'',label:'No linked activity'},...this._activities.map(a => ({value:a.id,label:new Date(a.time).toLocaleDateString('en-GB',{timeZone:'Europe/Berlin'}) + ' · ' + a.name}))]} @change=${this._benchmarkActivityChanged}></custom-select></label>
      ${this._draft.activityId ? html`<p class="helper">The date comes from the linked Garmin activity.</p>` : !this._busy && !this._activities.length ? html`<p class="helper">No Garmin activities in this period. You can still save this benchmark.</p>` : nothing}
      <label>Note (optional)<input name="note" .value=${this._draft.note || ''} maxlength="500" placeholder="e.g. Strict, full range of motion"></label>
      ${this._dialogError ? html`<p class="goals-error" role="alert">${this._dialogError}</p>` : nothing}
      <div class="goals-form-footer"><button type="button" class="goals-button" @click=${this._close}>Cancel</button><button class="goals-button primary" ?disabled=${this._busy}>Save benchmark</button></div>
    </form>`;
  }
  _categoryEditor() {
    return html`<div class="goals-form"><p class="helper">Categories organise goals. Groups such as Winter Arc name a training block.</p>
      ${this._data.categories.map(c => {
        const goals = this._data.goals.filter(g => g.category === c.id);
        return html`<div class="goal-category-editor-row"><form class="goal-category-form" @submit=${e => this._saveCategory(e, c)}><label>Category<input name="name" .value=${c.name} required maxlength="60" aria-label=${'Category name: ' + c.name}></label><button class="goals-button" ?disabled=${this._busy}>Rename</button><button type="button" class="goals-button" aria-label=${'Remove ' + c.name} ?disabled=${this._busy || this._data.categories.length < 2} @click=${() => this._startCategoryRemoval(c)}>Remove</button></form>
          ${this._categoryToRemove === c.id ? html`<div class="goal-category-removal"><p class="helper">${goals.length ? `${goals.length} goal${goals.length === 1 ? '' : 's'}, including archived goals, will move to the category you choose. Their progress is kept.` : 'This category has no goals.'} You can restore it later.</p>
            ${goals.length ? html`<label>Move goals to<custom-select aria-label="Move goals to" .value=${this._reassignTo} .items=${this._data.categories.filter(x => x.id !== c.id).map(x => ({value:x.id,label:x.name}))} @change=${e => {this._reassignTo = e.target.value;}}></custom-select></label>` : nothing}
            <div class="goals-actions"><button type="button" class="goals-button" ?disabled=${this._busy} @click=${() => {this._categoryToRemove = '';}}>Cancel</button><button type="button" class="goals-button primary" ?disabled=${this._busy} @click=${() => this._removeCategory(c)}>Remove category</button></div></div>` : nothing}</div>`;
      })}
      ${this._data.categories.length < 2 ? html`<p class="helper">Add another category before removing the last one.</p>` : nothing}
      <form class="goal-category-form" @submit=${e => this._saveCategory(e)}><label>New category<input name="name" required maxlength="60" placeholder="Category name"></label><button class="goals-button primary" ?disabled=${this._busy}>Add</button></form>
      ${this._data.removedCategories?.length ? html`<details class="goal-removed-categories"><summary>Removed categories (${this._data.removedCategories.length})</summary>${this._data.removedCategories.map(c => html`<div class="goal-removed-category"><span>${c.name}</span><button type="button" class="goals-button" aria-label=${'Restore ' + c.name} ?disabled=${this._busy} @click=${() => this._restoreCategory(c)}>Restore</button></div>`)}</details>` : nothing}
      ${this._dialogError ? html`<p class="goals-error" role="alert">${this._dialogError}</p>` : nothing}</div>`;
  }
  _goalDetails() {
    const g = this._goal, p = g.progress, automatic = !['manual', 'milestones'].includes(g.metric), max = Math.max(1, ...p.series.map(w => w.value));
    return html`<div class="goal-details"><p>${dateLabel(g.startDate)}–${dateLabel(g.endDate)} ${g.endDate.slice(0, 4)} · ${g.period === 'weekly' ? 'Target resets each Monday, Europe/Berlin.' : 'Target covers the whole period.'}</p>
      ${automatic ? html`<h3>Last six weeks</h3><div class="goals-trend" aria-label="Weekly progress">${p.series.map(w => html`<div class="goals-trend-item"><span>${fmt(w.value)} ${g.unit}</span><div class="bar ${w.value ? '' : 'zero'}" style="height:${w.value / max * 95}px"></div><span>${dateLabel(w.date)}</span></div>`)}</div><h3>Contributing Garmin activities</h3>${p.activities.length ? p.activities.map(a => html`<div class="goal-activity"><div><a href=${this._activityLink(a.id)} target=${this._data.demo ? '_blank' : '_self'} rel="noopener">${a.name}</a><small>${dateLabel(a.date)} · ${formatType(a.type)}</small></div><span>${g.metric === 'duration' ? formatDuration(a.duration || 0) : g.metric === 'count' ? '1 session' : formatDistance(a.distance || 0)}</span></div>`) : html`<p>No matching activities in this goal period.</p>`}` : g.metric === 'manual' ? html`<h3>Benchmarks</h3>${p.entries.length ? [...p.entries].sort((a, b) => b.date.localeCompare(a.date)).map(e => html`<div class="goal-activity"><div>${e.activityId ? html`<a href=${this._activityLink(e.activityId)} target=${this._data.demo ? '_blank' : '_self'} rel="noopener">${dateLabel(e.date)} · Garmin activity</a>` : html`<span>${dateLabel(e.date)} · Manual benchmark</span>`}<small>${e.note}</small></div><div><span>${fmt(e.value)} ${g.unit}</span><button class="goals-button" style="margin-left:10px" @click=${() => this._openBenchmark(g, e)}>Edit</button></div></div>`) : html`<p>No benchmarks recorded yet.</p>`}` : html`<p>${p.value} of ${g.target} milestones complete.</p>`}
    </div>`;
  }
  render() {
    if (!this._data) return html`<div class="goals-error-panel">${this._error ? html`<p class="goals-error">${this._error}</p><button class="goals-button" @click=${this._load}>Try again</button>` : 'Loading goals…'}</div>`;
    const all = this._data.goals, groups = [...new Set(all.map(g => g.group).filter(Boolean))].sort();
    const goals = all.filter(g => !!g.archived === this._archived && (!this._group || g.group === this._group) && (!this._category || g.category === this._category));
    const categories = this._data.categories.filter(c => (!this._category || c.id === this._category) && (goals.some(g => g.category === c.id) || !all.length));
    const title = this._mode === 'goal' ? this._goal ? 'Edit goal' : 'New goal' : this._mode === 'categories' ? 'Categories' : this._mode === 'benchmark' ? this._entry ? 'Edit benchmark' : 'Add benchmark' : this._goal?.title || '';
    return html`${this._data.demo ? html`<div class="goals-demo"><strong>Local demo</strong> · Garmin snapshot ${this._data.latestActivity ? new Date(this._data.latestActivity).toLocaleDateString('en-GB', {timeZone:'Europe/Berlin',day:'numeric',month:'short'}) : ''}. Targets are suggestions; changes stay in this demo.</div>` : nothing}
      <div class="goals-heading"><div><h1>Goals</h1><p>Progress from your Garmin activities. Benchmarks and skills added by you.</p></div><div class="goals-actions"><button class="goals-button" @click=${() => { this._mode = 'categories'; this._dialogError = ''; }}>Categories</button><button class="goals-button primary" @click=${() => this._openGoal()}>New goal</button></div></div>
      <div class="goals-filters"><label>Group<custom-select aria-label="Group" .value=${this._group} .items=${[{value:'',label:'All groups'},...groups.map(g => ({value:g,label:g}))]} @change=${e => { this._group = e.target.value; }}></custom-select></label><label>Category<custom-select aria-label="Category" .value=${this._category} .items=${[{value:'',label:'All categories'},...this._data.categories.map(c => ({value:c.id,label:c.name}))]} @change=${e => { this._category = e.target.value; }}></custom-select></label><label>Show<custom-select aria-label="Show" .value=${this._archived ? 'archived' : 'active'} .items=${[{value:'active',label:'Active goals'},{value:'archived',label:'Archived goals'}]} @change=${e => { this._archived = e.target.value === 'archived'; }}></custom-select></label><span class="goals-count">${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}</span></div>
      ${this._error ? html`<div class="goals-error-panel"><p class="goals-error" role="alert">${this._error}</p><button class="goals-button" @click=${this._load}>Try again</button></div>` : nothing}
      ${goals.length ? html`<div class="goals-columns">${categories.map((c, i) => html`<section class="goal-category"><div class="goal-category-header"><h2>${c.name}</h2><span>${String(i + 1).padStart(2, '0')} / ${goals.filter(g => g.category === c.id).length} goals</span></div>${goals.filter(g => g.category === c.id).map(g => this._progressCard(g))}<button class="goals-button quiet" style="margin-top:16px" @click=${() => this._openGoal(null, c.id)}>Add to ${c.name}</button></section>`)}</div>` : html`<section class="goals-empty"><h2>${all.length ? 'No goals in this view.' : 'Choose what you want to build.'}</h2><p>${all.length ? 'Change the filters or create a goal in this category.' : 'Set training-time, distance or activity-count goals. Track clean-rep benchmarks and skill milestones in your own categories.'}</p><div class="goals-actions">${!all.some(g => g.group === 'Winter Arc' && !g.archived) && !this._archived ? html`<button class="goals-button primary" ?disabled=${this._busy} @click=${this._starter}>Use Winter Arc starting goals</button>` : nothing}<button class="goals-button" @click=${() => this._openGoal()}>Create a goal</button></div><p class="goals-note">Winter Arc targets are editable suggestions. No rep baselines or activities are invented.</p></section>`}
      <p class="goals-note">Garmin remains the source for activities. Goals and benchmarks are saved separately.</p>
      <dialog class="goals-dialog" aria-labelledby="goals-dialog-title" @cancel=${this._close}><div class="goals-dialog-header"><h2 id="goals-dialog-title">${title}</h2><button aria-label="Close" @click=${this._close}>×</button></div>${this._mode === 'goal' ? this._editor() : this._mode === 'benchmark' ? this._benchmarkEditor() : this._mode === 'categories' ? this._categoryEditor() : this._mode === 'details' ? this._goalDetails() : nothing}</dialog>
      ${this._notice ? html`<div class="goals-status" role="status">${this._notice}</div>` : nothing}`;
  }
}
customElements.define('goals-page', GoalsPage);
