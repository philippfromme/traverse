import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';

export const METRICS = ['duration', 'distance', 'count', 'longest', 'manual', 'milestones'];
export const DEFAULT_CATEGORIES = [{ id: 'endurance', name: 'Endurance' }, { id: 'strength', name: 'Strength' }];
const berlinDateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
export function dayKey(value = new Date()) {
  const d = new Date(value);
  if (!Number.isFinite(d.valueOf())) return null;
  const parts = berlinDateFormatter.formatToParts(d);
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k).value).join('-');
}
function dateValid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(value + 'T12:00:00Z');
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
export function shiftDay(day, days) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekStart(day) {
  return shiftDay(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
}
export function matchesActivity(activity, filters) {
  return filters.some(filter => filter === activity.type || (activity.subSport && filter === `${activity.type}:${activity.subSport}`));
}
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e9;
function cleanText(value, max) { return String(value ?? '').trim().slice(0, max); }
export function validateGoal(input, existing = null) {
  if (existing && ((existing.entries || []).length || (existing.milestones || []).some(m => m.achievedAt)) && (input.metric !== existing.metric || (input.metric === 'manual' && input.unit !== existing.unit))) throw new Error('This goal has recorded progress. Create a new goal to change its measurement or unit.');
  const title = cleanText(input.title, 100);
  const category = input.category || input.track;
  if (!title || !/^[\w-]{1,100}$/.test(category || '') || !METRICS.includes(input.metric)) throw new Error('Choose a title, category and measurement.');
  if (!dateValid(input.startDate) || !dateValid(input.endDate) || input.endDate < input.startDate) throw new Error('Choose a valid start and end date.');
  if (!['weekly', 'range'].includes(input.period)) throw new Error('Choose a goal period.');
  if (['manual', 'milestones'].includes(input.metric) && input.period !== 'range') throw new Error('Benchmarks and milestones use the whole goal period.');
  const activityTypes = [...new Set(Array.isArray(input.activityTypes) ? input.activityTypes.filter(x => typeof x === 'string' && /^[\w:-]{1,100}$/.test(x)) : [])];
  if (!['manual', 'milestones'].includes(input.metric) && !activityTypes.length) throw new Error('Select at least one Garmin activity type.');
  const milestones = input.metric === 'milestones' ? (Array.isArray(input.milestones) ? input.milestones : []).slice(0, 20).map(m => {
    const label = cleanText(m.label, 120);
    if (!label) throw new Error('Each milestone needs a name.');
    const old = existing?.milestones?.find(x => x.id === m.id);
    return { id: old?.id || randomUUID(), label, achievedAt: old?.achievedAt || null };
  }) : [];
  if (input.metric === 'milestones' && !milestones.length) throw new Error('Add at least one milestone.');
  const target = milestones.length || Number(input.target);
  if (!positive(target) || (input.metric === 'count' && !Number.isInteger(target))) throw new Error('Set a positive target; session targets need a whole number.');
  const baseline = input.baseline === '' || input.baseline == null ? null : Number(input.baseline);
  if (baseline !== null && (!Number.isFinite(baseline) || baseline < 0 || baseline > 1e9)) throw new Error('Check your baseline.');
  return {
    id: existing?.id || randomUUID(), title, category, metric: input.metric,
    group: cleanText(input.group, 60), target, baseline: input.metric === 'manual' ? baseline : null,
    unit: input.metric === 'manual' ? cleanText(input.unit || 'reps', 20) : { duration: 'h', distance: 'km', count: 'sessions', longest: 'km', milestones: 'milestones' }[input.metric],
    period: input.period, startDate: input.startDate, endDate: input.endDate, activityTypes,
    milestones, entries: existing && existing.metric === input.metric ? existing.entries || [] : [],
    archived: existing?.archived || false, createdAt: existing?.createdAt || new Date().toISOString(),
  };
}
function contribution(activity, metric) {
  if (metric === 'count') return 1;
  const value = metric === 'duration' ? (activity.timerDuration ?? activity.duration) : activity.distance;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value / (metric === 'duration' ? 3600 : 1000);
}
export function goalProgress(goal, activities, now = new Date()) {
  const today = dayKey(now), reference = today < goal.startDate ? goal.startDate : today > goal.endDate ? goal.endDate : today;
  const start = goal.period === 'weekly' ? [goal.startDate, weekStart(reference)].sort().at(-1) : goal.startDate;
  const end = goal.period === 'weekly' ? [goal.endDate, shiftDay(weekStart(reference), 6)].sort()[0] : goal.endDate;
  // Garmin activity IDs are the identity boundary; exports of the same activity count once.
  const unique = [...new Map(activities.filter(a => a.id).map(a => [a.id, a])).values()];
  const selected = unique.filter(a => {
    const date = dayKey(a.time);
    return date && date >= start && date <= end && date <= today && matchesActivity(a, goal.activityTypes);
  });
  const wholePeriod = unique.filter(a => {
    const date = dayKey(a.time);
    return date && date >= goal.startDate && date <= goal.endDate && date <= today && matchesActivity(a, goal.activityTypes);
  });
  const benchmarkEntries = (goal.entries || []).filter(e => (!e.activityId || unique.some(a => a.id === e.activityId)) && e.date >= goal.startDate && e.date <= goal.endDate && e.date <= today);
  let value;
  if (goal.metric === 'manual') value = benchmarkEntries.length ? Math.max(goal.baseline ?? 0, ...benchmarkEntries.map(e => e.value)) : goal.baseline;
  else if (goal.metric === 'milestones') value = goal.milestones.filter(m => m.achievedAt && m.achievedAt >= goal.startDate && m.achievedAt <= goal.endDate && m.achievedAt <= today).length;
  else value = goal.metric === 'longest' ? Math.max(0, ...selected.map(a => contribution(a, goal.metric))) : selected.reduce((sum, a) => sum + contribution(a, goal.metric), 0);
  const series = Array.from({ length: 6 }, (_, i) => {
    const date = shiftDay(weekStart(reference), (i - 5) * 7), last = shiftDay(date, 6);
    const subset = wholePeriod.filter(a => { const d = dayKey(a.time); return d >= date && d <= last; });
    return { date, value: goal.metric === 'longest' ? Math.max(0, ...subset.map(a => contribution(a, goal.metric))) : subset.reduce((sum, a) => sum + contribution(a, goal.metric), 0) };
  });
  const activityRefs = selected.sort((a, b) => goal.metric === 'longest' ? (b.distance || 0) - (a.distance || 0) : new Date(b.time) - new Date(a.time)).slice(0, 12).map(a => ({ id: a.id, name: a.name, date: dayKey(a.time), type: a.type, duration: a.timerDuration ?? a.duration, distance: a.distance }));
  return { value, percent: value == null ? 0 : Math.min(100, value / goal.target * 100), start, end,
    status: today < goal.startDate ? 'upcoming' : value != null && value >= goal.target ? 'achieved' : today > goal.endDate ? 'ended' : 'active',
    activityCount: selected.length, activities: activityRefs, series, entries: benchmarkEntries };
}

export function createGoalStore(filename) {
  let queue = Promise.resolve();
  function read() {
    if (!fs.existsSync(filename)) return { version: 1, categories: structuredClone(DEFAULT_CATEGORIES), removedCategories: [], goals: [] };
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.goals)) throw new Error('Unsupported or damaged goals file.');
    data.categories ||= structuredClone(DEFAULT_CATEGORIES);
    data.removedCategories ||= [];
    return data;
  }
  function mutate(change) {
    const operation = queue.then(async () => {
      const data = read(), result = await change(data);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const temporary = filename + '.' + randomUUID() + '.tmp';
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      try { fs.renameSync(temporary, filename); }
      catch (error) { fs.unlinkSync(temporary); throw error; }
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { read, mutate };
}

export function goalTemplates(startDate, endDate) {
  return [
    { title: 'Weekly endurance', track: 'endurance', metric: 'duration', target: 3, period: 'weekly', activityTypes: ['cycling', 'running', 'training:elliptical', 'training:treadmill', 'fitness_equipment:elliptical'] },
    { title: 'A 100 km ride', track: 'endurance', metric: 'longest', target: 100, period: 'range', activityTypes: ['cycling'] },
    { title: 'Weekly strength', track: 'strength', metric: 'count', target: 2, period: 'weekly', activityTypes: ['training:strength_training', 'training:calisthenics'] },
    ...[['Pull-ups', 10], ['Dips', 15], ['Push-ups', 25]].map(([title, target]) => ({ title, target, track: 'strength', metric: 'manual', unit: 'reps', period: 'range' })),
    { title: 'First muscle-up', track: 'strength', metric: 'milestones', period: 'range', milestones: ['Repeatable strict pull-ups', 'Controlled high pulls', 'Confident straight-bar dips', 'Controlled transition practice', 'First muscle-up'].map(label => ({ label })) },
  ].map(g => validateGoal({ ...g, group: 'Winter Arc', startDate, endDate }));
}

export function registerGoals(app, { dataDir, getActivities, demo = false, sourceUrl = '' }) {
  const store = createGoalStore(path.join(dataDir, 'goals.json'));
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      const origin = req.get('origin');
      let foreignOrigin = false;
      if (origin) { try { foreignOrigin = new URL(origin).host !== req.get('host'); } catch { foreignOrigin = true; } }
      if (req.get('sec-fetch-site') === 'cross-site' || foreignOrigin) return res.status(403).json({ error: 'Open this action from Traverse.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Send a JSON goal.' });
    }
    next();
  });
  const run = fn => async (req, res) => { try { await fn(req, res); } catch (error) { console.error('[goals]', error.message); res.status(error.status || 503).json({ error: error.status ? error.message : 'Goals could not be loaded or saved. Please try again. Your input has been preserved.' }); } };
  const invalid = message => Object.assign(new Error(message), { status: 400 });
  function find(data, id) { const goal = data.goals.find(g => g.id === id); if (!goal) throw Object.assign(new Error('Goal not found.'), { status: 404 }); return goal; }
  router.get('/', run((req, res) => {
    const activities = getActivities(), stored = store.read(), goals = stored.goals;
    const types = new Map();
    const label = type => type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    for (const a of activities) {
      types.set(a.type, label(a.type));
      if (a.subSport && a.subSport !== 'generic') types.set(`${a.type}:${a.subSport}`, `${label(a.type)} · ${label(a.subSport)}`);
    }
    for (const [type, text] of [['training:strength_training', 'Strength Training (FIT subtype)'], ['training:calisthenics', 'Calisthenics (FIT subtype)'], ['training:elliptical', 'Elliptical (FIT subtype)'], ['training:treadmill', 'Treadmill (FIT subtype)'], ['fitness_equipment:elliptical', 'Fitness Equipment · Elliptical']]) types.set(type, text);
    const latest = activities.map(a => a.time).filter(Boolean).sort().at(-1) || null;
    res.json({ categories: stored.categories, removedCategories: stored.removedCategories.map(({id,name}) => ({id,name})), goals: goals.map(g => ({ ...g, progress: goalProgress(g, activities) })), activityTypes: [...types].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })), demo, sourceUrl, latestActivity: latest,
      unclassifiedTraining: activities.filter(a => a.type === 'training' && !a.subSport).length });
  }));
  router.post('/', run(async (req, res) => {
    let goal; try { goal = validateGoal(req.body); } catch (e) { throw invalid(e.message); }
    await store.mutate(data => { if (!data.categories.some(c => c.id === goal.category)) throw invalid('Choose an existing category.'); if (data.goals.length >= 500) throw invalid('Archive or reuse an existing goal.'); data.goals.push(goal); });
    res.status(201).json(goal);
  }));
  router.post('/categories', run(async (req, res) => {
    const name = cleanText(req.body.name, 60);
    if (!name) throw invalid('Give this category a name.');
    const category = { id: randomUUID(), name };
    await store.mutate(data => {
      if (data.categories.length >= 30) throw invalid('You have reached the category limit.');
      if (data.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) throw invalid('This category already exists.');
      data.categories.push(category);
    }); res.status(201).json(category);
  }));
  router.put('/categories/:categoryId', run(async (req, res) => {
    const name = cleanText(req.body.name, 60);
    if (!name) throw invalid('Give this category a name.');
    await store.mutate(data => {
      const category = data.categories.find(c => c.id === req.params.categoryId);
      if (!category) throw invalid('Category not found.');
      if (data.categories.some(c => c.id !== category.id && c.name.toLowerCase() === name.toLowerCase())) throw invalid('This category already exists.');
      category.name = name;
    }); res.json({ ok: true });
  }));
  router.post('/categories/:categoryId/remove', run(async (req, res) => {
    await store.mutate(data => {
      const category = data.categories.find(c => c.id === req.params.categoryId);
      if (!category) throw invalid('Category not found.');
      if (data.categories.length === 1) throw invalid('Add another category before removing this one.');
      const goals = data.goals.filter(g => g.category === category.id);
      const destination = data.categories.find(c => c.id === req.body.moveTo && c.id !== category.id);
      if (goals.length && !destination) throw invalid('Choose a category for the existing goals.');
      data.removedCategories.push({ ...category, position: data.categories.indexOf(category), goalIds: goals.map(g => g.id), reassignedTo: destination?.id || null, removedAt: new Date().toISOString() });
      for (const goal of goals) goal.category = destination.id;
      data.categories = data.categories.filter(c => c.id !== category.id);
    }); res.json({ ok: true });
  }));
  router.post('/categories/:categoryId/restore', run(async (req, res) => {
    await store.mutate(data => {
      const category = data.removedCategories.find(c => c.id === req.params.categoryId);
      if (!category) throw invalid('Removed category not found.');
      if (data.categories.length >= 30) throw invalid('You have reached the category limit.');
      if (data.categories.some(c => c.id === category.id || c.name.toLowerCase() === category.name.toLowerCase())) throw invalid('Rename the existing category with this name before restoring.');
      data.categories.splice(Math.min(category.position ?? data.categories.length, data.categories.length), 0, { id: category.id, name: category.name });
      for (const goal of data.goals) if (category.goalIds.includes(goal.id) && goal.category === category.reassignedTo) goal.category = category.id;
      data.removedCategories = data.removedCategories.filter(c => c.id !== category.id);
    }); res.json({ ok: true });
  }));
  router.post('/winter-arc', run(async (req, res) => {
    const start = req.body.startDate || dayKey(), end = req.body.endDate || `${Number(start.slice(0, 4)) + 1}-01-31`;
    let goals; try { goals = goalTemplates(start, end); } catch (e) { throw invalid(e.message); }
    await store.mutate(data => {
      if (data.goals.some(g => g.group === 'Winter Arc' && !g.archived)) throw invalid('Winter Arc goals already exist. Edit them or create another group.');
      for (const category of DEFAULT_CATEGORIES) if (!data.categories.some(c => c.id === category.id)) data.categories.push({ ...category });
      data.goals.push(...goals);
    });
    res.status(201).json({ goals });
  }));
  router.put('/:id', run(async (req, res) => {
    const goal = await store.mutate(data => {
      const old = find(data, req.params.id); let updated;
      try { updated = validateGoal(req.body, old); } catch (e) { throw invalid(e.message); }
      if (!data.categories.some(c => c.id === updated.category)) throw invalid('Choose an existing category.');
      data.goals[data.goals.indexOf(old)] = updated; return updated;
    });
    res.json(goal);
  }));
  router.patch('/:id/archive', run(async (req, res) => {
    if (typeof req.body.archived !== 'boolean') throw invalid('Choose archive or restore.');
    await store.mutate(data => { find(data, req.params.id).archived = req.body.archived; }); res.json({ ok: true });
  }));
  const saveBenchmark = run(async (req, res) => {
    if (req.body.value === '' || req.body.value == null || !Number.isFinite(Number(req.body.value)) || Number(req.body.value) < 0 || Number(req.body.value) > 1e9) throw invalid('Enter a valid benchmark value.');
    const activity = req.body.activityId ? getActivities().find(a => a.id === req.body.activityId) : null;
    if (req.body.activityId && !activity) throw invalid('Select an existing Garmin activity or save without a link.');
    const date = activity ? dayKey(activity.time) : req.body.date;
    if (!dateValid(date)) throw invalid('Choose a valid benchmark date.');
    await store.mutate(data => {
      const goal = find(data, req.params.id);
      if (goal.metric !== 'manual' || goal.archived) throw invalid('This goal cannot receive a benchmark.');
      if (date < goal.startDate || date > goal.endDate || date > dayKey()) throw invalid('Choose a benchmark date inside the goal period, up to today.');
      if ((goal.entries || []).length >= 2000) throw invalid('This goal has reached its entry limit.');
      const index = req.params.entryId ? goal.entries.findIndex(e => e.id === req.params.entryId) : -1;
      if (req.params.entryId && index < 0) throw invalid('Benchmark not found.');
      const entry = { id: req.params.entryId || randomUUID(), activityId: activity?.id || null, date, value: Number(req.body.value), note: cleanText(req.body.note, 500) };
      if (index >= 0) goal.entries[index] = entry; else goal.entries.push(entry);
    }); res.status(req.params.entryId ? 200 : 201).json({ ok: true });
  });
  router.post('/:id/benchmarks', saveBenchmark);
  router.put('/:id/benchmarks/:entryId', saveBenchmark);
  router.patch('/:id/milestones/:milestoneId', run(async (req, res) => {
    if (typeof req.body.checked !== 'boolean') throw invalid('Choose completed or incomplete.');
    await store.mutate(data => {
      const goal = find(data, req.params.id), milestone = goal.milestones.find(m => m.id === req.params.milestoneId);
      if (goal.metric !== 'milestones' || !milestone || goal.archived) throw invalid('Milestone not found.');
      if (req.body.checked && (dayKey() < goal.startDate || dayKey() > goal.endDate)) throw invalid('This milestone is outside the goal period.');
      milestone.achievedAt = req.body.checked ? dayKey() : null;
    }); res.json({ ok: true });
  }));
  router.use((err, req, res, next) => { if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Could not read this goal. Check the submitted values.' }); next(err); });
  app.use('/api/goals', router);
}
