import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { activeRace, dayKey, raceOverview, raceCalendar } from './race-planning.js';
import { BERLIN_2027 } from './race-templates.js';

const invalid = message => Object.assign(new Error(message), { status: 400 });
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '1900-01-01' && d <= '2200-12-31' && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
export function validateRace(input, existing = null) {
  const name = text(input.name, 160), startDate = input.startDate, endDate = input.endDate || startDate;
  if (!name || !validDay(startDate) || !validDay(endDate) || endDate < startDate) throw invalid('Enter a name and valid race dates.');
  const distanceMeters = Number(input.distanceMeters);
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || distanceMeters > 1000000) throw invalid('Enter a distance between 0 and 1,000 km.');
  let website = text(input.website, 2000);
  if (website) { let url; try { url = new URL(website); } catch { throw invalid('Enter a full http or https website URL.'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid('Use an http or https website URL without credentials.'); website = url.href; }
  const targetTimeSeconds = input.targetTimeSeconds === '' || input.targetTimeSeconds == null ? null : Number(input.targetTimeSeconds);
  if (targetTimeSeconds !== null && (!Number.isInteger(targetTimeSeconds) || targetTimeSeconds <= 0 || targetTimeSeconds > 604800)) throw invalid('Enter a valid positive target time.');
  const registrationStatus = input.registrationStatus ?? 'interested', outcome = input.outcome ?? 'planned';
  if (!['interested', 'registered'].includes(registrationStatus) || !['planned', 'finished', 'dns', 'dnf', 'cancelled'].includes(outcome)) throw invalid('Choose a valid race status.');
  return { id: existing?.id || randomUUID(), name, startDate, endDate, dateConfirmed: startDate === endDate && input.dateConfirmed !== false,
    distanceMeters, website, location: text(input.location, 200), notes: text(input.notes, 4000), registrationStatus, outcome,
    targetTimeSeconds, activityId: input.activityId ? text(input.activityId, 150) : null, archived: input.archived === true,
    ...(existing?.templateKey ? { templateKey: existing.templateKey } : {}),
    createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function createRaceStore(filename) {
  let queue = Promise.resolve();
  const read = () => {
    if (!fs.existsSync(filename)) return { version: 1, races: [], settings: { targetRaceId: null, weeklyDistanceKm: null, runDays: 3 } };
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.races) || !data.settings || ![2, 3, 4, 5].includes(data.settings.runDays)) throw new Error('Unsupported or damaged races file.');
    for (const race of data.races) { validateRace(race, race); if (!race.id || !Number.isFinite(Date.parse(race.updatedAt))) throw new Error('Damaged race record.'); }
    return data;
  };
  const mutate = change => {
    const operation = queue.then(async () => {
      const data = read(), result = await change(data);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const temporary = filename + '.' + randomUUID() + '.tmp';
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, filename);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  };
  return { read, mutate };
}

export function registerRaces(app, { dataDir, getActivities, now = () => new Date() }) {
  const store = createRaceStore(path.join(dataDir, 'races.json')), router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      let foreign = false;
      if (req.get('origin')) { try { foreign = new URL(req.get('origin')).host !== req.get('host'); } catch { foreign = true; } }
      if (foreign || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Open this action from Traverse.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON race data.' });
    }
    next();
  });
  router.use(express.json({ limit: '64kb' }));
  const run = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'Races could not be loaded or saved. Your input has been preserved.' }); } };
  const overview = () => raceOverview(store.read(), getActivities(), now());
  const yearOf = req => { const y = req.query.year; if (y !== undefined && (typeof y !== 'string' || !/^\d{4}$/.test(y) || Number(y) < 1900 || Number(y) > 2200)) throw invalid('Choose a year between 1900 and 2200.'); return y; };
  const inYear = (r, year) => !year || (r.startDate <= `${year}-12-31` && r.endDate >= `${year}-01-01`);
  router.get('/overview', run((req, res) => { const { races, ...data } = overview(); res.json(data); }));
  router.get('/templates/berlin-2027', run((req, res) => res.json({ checkedAt: '2026-10-19', races: BERLIN_2027 })));
  router.post('/templates/berlin-2027', run(async (req, res) => {
    const count = await store.mutate(data => {
      let added = 0;
      for (const template of BERLIN_2027) {
        if (data.races.some(r => r.templateKey === template.key || (r.website === template.website && r.startDate === template.startDate))) continue;
        data.races.push({ ...validateRace(template), templateKey: template.key }); added++;
      }
      return added;
    }); res.json({ added: count });
  }));
  router.get('/calendar.ics', run((req, res) => { const year = yearOf(req); res.set('Content-Disposition', 'attachment; filename="traverse-races.ics"').type('text/calendar').send(raceCalendar(store.read().races.filter(r => inYear(r, year)))); }));
  router.get('/', run((req, res) => {
    const year = yearOf(req), data = overview();
    const years = new Set([Number(data.today.slice(0, 4)), ...(year ? [Number(year)] : [])]);
    data.races.forEach(r => { for (let y = Number(r.startDate.slice(0, 4)); y <= Number(r.endDate.slice(0, 4)); y++) years.add(y); });
    res.json({ ...data, races: data.races.filter(r => inYear(r, year)), years: [...years].sort((a, b) => a - b) });
  }));
  router.put('/settings', run(async (req, res) => {
    const settings = await store.mutate(data => {
      const input = req.body;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Send planning settings.');
      const s = { ...data.settings };
      if ('targetRaceId' in input) {
        if (input.targetRaceId !== null && !data.races.some(r => r.id === input.targetRaceId && activeRace(r) && r.endDate >= dayKey(now()))) throw invalid('Choose an active upcoming race.');
        s.targetRaceId = input.targetRaceId;
      }
      if ('runDays' in input) { if (![2, 3, 4, 5].includes(input.runDays)) throw invalid('Choose two to five run days.'); s.runDays = input.runDays; }
      if ('weeklyDistanceKm' in input) { const km = input.weeklyDistanceKm; if (km !== null && (typeof km !== 'number' || !Number.isFinite(km) || km <= 0 || km > 1000)) throw invalid('Enter a positive weekly distance or use activity data.'); s.weeklyDistanceKm = km; }
      data.settings = s; return s;
    }); res.json(settings);
  }));
  const save = async (req, res, editing) => {
    const saved = await store.mutate(data => {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw invalid('Send race data.');
      const existing = editing ? data.races.find(r => r.id === req.params.id) : null;
      if (editing && !existing) throw Object.assign(new Error('Race not found.'), { status: 404 });
      const race = validateRace({ ...existing, ...req.body }, existing);
      if (race.activityId && race.activityId !== existing?.activityId && !getActivities().some(a => a.id === race.activityId && a.type === 'running' && a.time && dayKey(a.time) && dayKey(a.time) <= dayKey(now()))) throw invalid('Choose an existing completed running activity.');
      if (existing) data.races[data.races.indexOf(existing)] = race; else data.races.push(race);
      if (!activeRace(race) && data.settings.targetRaceId === race.id) data.settings.targetRaceId = null;
      return race;
    }); res.status(editing ? 200 : 201).json(saved);
  };
  router.post('/', run((req, res) => save(req, res, false)));
  router.put('/:id', run((req, res) => save(req, res, true)));
  router.use((err, req, res, next) => { res.status(err.status || 400).json({ error: 'Could not read race data. Send valid JSON up to 64 KB.' }); });
  app.use('/api/races', router);
  return store;
}
