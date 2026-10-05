import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { goalProgress, validateGoal, createGoalStore, dayKey, registerGoals } from './goals.js';

const base = { title: 'Endurance', category: 'endurance', metric: 'duration', target: 3, period: 'weekly', startDate: '2026-09-01', endDate: '2027-01-31', activityTypes: ['cycling'] };
const ride = (id, time, overrides = {}) => ({ id, time, type: 'cycling', duration: 7200, distance: 50000, ...overrides });
test('weekly goals use Berlin dates, timer time, explicit filters and unique Garmin IDs', () => {
  const goal = validateGoal(base);
  const activities = [ride('a', '2026-09-27T22:30:00Z', { timerDuration: 3600 }), ride('a', '2026-09-27T22:30:00Z', { timerDuration: 3600 }), ride('previous', '2026-09-27T10:00:00Z'), ride('run', '2026-09-29T10:00:00Z', { type: 'running' }), ride('future', '2026-10-05T10:00:00Z')];
  const p = goalProgress(goal, activities, new Date('2026-10-02T12:00:00Z'));
  assert.equal(p.value, 1); assert.equal(p.start, '2026-09-28'); assert.equal(p.end, '2026-10-04'); assert.equal(p.activityCount, 1);
});
test('distance and longest ride use kilometres and respect goal start date', () => {
  const activities = [ride('before', '2026-09-01T12:00:00Z', { distance: 150000 }), ride('a', '2026-10-02T06:00:00Z', { distance: 45000 }), ride('b', '2026-10-02T09:00:00Z', { distance: 30000 })];
  const goal = validateGoal({ ...base, metric: 'longest', period: 'range', startDate: '2026-10-01', target: 100 });
  assert.equal(goalProgress(goal, activities, new Date('2026-10-02T12:00:00Z')).value, 45);
  assert.equal(goalProgress({ ...goal, metric: 'distance' }, activities, new Date('2026-10-02T12:00:00Z')).value, 75);
});
test('strength subtype filters exclude unclassified training', () => {
  const goal = validateGoal({ ...base, category: 'strength', metric: 'count', target: 2, activityTypes: ['training:strength_training'] });
  const activities = [ride('a', '2026-10-02T09:00:00Z', { type: 'training' }), ride('b', '2026-10-02T10:00:00Z', { type: 'training', subSport: 'strength_training' })];
  assert.equal(goalProgress(goal, activities, new Date('2026-10-02T12:00:00Z')).value, 1);
});
test('manual benchmarks support standalone records and ignore missing activity links', () => {
  const goal = validateGoal({ ...base, metric: 'manual', period: 'range', unit: 'reps', target: 10, activityTypes: [] });
  goal.entries = [{ id: 'entry', activityId: 'real', date: '2026-10-02', value: 7 }, { id: 'orphan', activityId: 'missing', date: '2026-10-02', value: 30 }, { id: 'standalone', activityId: null, date: '2026-10-01', value: 8 }, { id: 'future', activityId: null, date: '2026-11-01', value: 50 }];
  assert.equal(goalProgress(goal, [ride('real', '2026-10-02T12:00:00Z')], new Date('2026-10-02T14:00:00Z')).value, 8);
  assert.equal(goalProgress(goal, [], new Date('2026-10-02T14:00:00Z')).value, 8);
  assert.throws(() => validateGoal({ ...goal, metric: 'distance' }, goal), /recorded progress/);
});
test('editing milestone labels and order preserves their identities and completion', () => {
  const goal = validateGoal({ ...base, metric: 'milestones', period: 'range', milestones: [{label:'First step'},{label:'Second step'}] });
  goal.milestones[0].achievedAt = '2026-10-01';
  const updated = validateGoal({ ...goal, milestones: [{id:goal.milestones[1].id,label:'Renamed second step'},{id:goal.milestones[0].id,label:'Renamed first step'},{label:'New step'}] }, goal);
  assert.equal(updated.milestones[0].id, goal.milestones[1].id);
  assert.equal(updated.milestones[1].id, goal.milestones[0].id);
  assert.equal(updated.milestones[1].achievedAt, '2026-10-01');
  assert.equal(updated.milestones[2].achievedAt, null); assert.equal(updated.target, 3);
  assert.equal(goalProgress(updated, [], new Date('2026-10-02T12:00:00Z')).value, 1);
});
test('invalid dates are rejected and a week resets across the daylight saving boundary', () => {
  assert.throws(() => validateGoal({ ...base, startDate: '2026-02-30' }), /valid start/);
  assert.equal(dayKey('2026-10-25T23:30:00Z'), '2026-10-26');
  const p = goalProgress(validateGoal(base), [ride('old', '2026-10-25T10:00:00Z')], new Date('2026-10-26T10:00:00Z'));
  assert.equal(p.value, 0); assert.equal(p.start, '2026-10-26');
  const upcoming = goalProgress(validateGoal({ ...base, startDate: '2027-01-01' }), [], new Date('2026-10-02T12:00:00Z'));
  assert.equal(upcoming.status, 'upcoming'); assert.equal(upcoming.start, '2027-01-01'); assert.equal(upcoming.end, '2027-01-03');
});
test('goals and categories survive reload and concurrent saves without touching activity data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-goals-test-')), filename = path.join(dir, 'goals.json');
  try {
    const store = createGoalStore(filename);
    await Promise.all([store.mutate(data => { data.goals.push(validateGoal(base)); }), store.mutate(data => { data.categories.push({ id: 'skills', name: 'Skills' }); })]);
    const reloaded = createGoalStore(filename).read();
    assert.equal(reloaded.goals.length, 1); assert.equal(reloaded.categories.length, 3);
    fs.writeFileSync(filename, '{damaged');
    await assert.rejects(store.mutate(data => { data.goals = []; }));
    assert.equal(fs.readFileSync(filename, 'utf8'), '{damaged');
  } finally { if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('traverse-goals-test-')) throw new Error('Unexpected test directory'); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Goals API supports categories, editable linked benchmarks and archive/restore', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-goals-test-'));
  const activities = [ride('garmin-id', '2026-10-02T09:00:00Z', { type: 'training' })];
  const before = JSON.stringify(activities), app = express();
  registerGoals(app, { dataDir: dir, getActivities: () => activities });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method, body) => fetch(origin + '/api/goals' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const categoryResponse = await request('/categories', 'POST', { name: 'Skills' });
    assert.equal(categoryResponse.status, 201); const category = await categoryResponse.json();
    assert.equal((await request('/categories/' + category.id, 'PUT', { name: 'Skill work' })).status, 200);
    const goalResponse = await request('', 'POST', { ...base, category: category.id, metric: 'manual', period: 'range', unit: 'reps', target: 10 });
    assert.equal(goalResponse.status, 201); const goal = await goalResponse.json();
    assert.equal((await request(`/${goal.id}/benchmarks`, 'POST', { activityId: 'missing', value: 8 })).status, 400);
    assert.equal((await request(`/${goal.id}/benchmarks`, 'POST', { activityId: 'garmin-id', value: 8 })).status, 201);
    let state = await (await request('', 'GET')).json(), saved = state.goals[0];
    assert.equal(saved.progress.value, 8);
    assert.equal((await request(`/${goal.id}/benchmarks/${saved.entries[0].id}`, 'PUT', { activityId: 'garmin-id', value: 6 })).status, 200);
    assert.equal((await request(`/${goal.id}/archive`, 'PATCH', { archived: true })).status, 200);
    assert.equal((await request(`/${goal.id}/archive`, 'PATCH', { archived: false })).status, 200);
    state = await (await request('', 'GET')).json();
    assert.equal(state.goals[0].progress.value, 6); assert.equal(state.categories.at(-1).name, 'Skill work');
    assert.equal(state.goals[0].archived, false); assert.equal(JSON.stringify(activities), before);
    const standaloneResponse = await request('', 'POST', { ...base, title: 'Standalone benchmark', category: category.id, metric: 'manual', period: 'range', unit: 'reps', target: 10 });
    const standalone = await standaloneResponse.json();
    assert.equal((await request(`/${standalone.id}/benchmarks`, 'POST', { date: '2026-10-02', value: 10 })).status, 201);
    state = await (await request('', 'GET')).json();
    let record = state.goals.find(g => g.id === standalone.id);
    assert.equal(record.progress.value, 10); assert.equal(record.progress.status, 'achieved');
    assert.equal(record.entries[0].activityId, null);
    const entryId = record.entries[0].id;
    assert.equal((await request(`/${standalone.id}/benchmarks`, 'POST', { date: '2026-02-30', value: 12 })).status, 400);
    assert.equal((await request(`/${standalone.id}/benchmarks`, 'POST', { date: '2026-11-01', value: 12 })).status, 400);
    assert.equal((await request(`/${standalone.id}/benchmarks`, 'POST', { date: '2026-10-02', value: '' })).status, 400);
    // Linking derives the date from Garmin; unlinking restores a user-entered date.
    assert.equal((await request(`/${standalone.id}/benchmarks/${entryId}`, 'PUT', { activityId: 'garmin-id', date: '2026-09-01', value: 8 })).status, 200);
    state = await (await request('', 'GET')).json(); record = state.goals.find(g => g.id === standalone.id);
    assert.equal(record.entries[0].date, '2026-10-02'); assert.equal(record.entries[0].activityId, 'garmin-id');
    assert.equal((await request(`/${standalone.id}/benchmarks/${entryId}`, 'PUT', { activityId: '', date: '2026-10-01', value: 9 })).status, 200);
    const persisted = createGoalStore(path.join(dir, 'goals.json')).read().goals.find(g => g.id === standalone.id);
    assert.equal(persisted.entries[0].activityId, null); assert.equal(persisted.entries[0].date, '2026-10-01');
    assert.equal(persisted.entries.length, 1);
    // Removing a category preserves archived goals and their recorded progress.
    await request(`/${goal.id}/archive`, 'PATCH', { archived: true });
    assert.equal((await request(`/categories/${category.id}/remove`, 'POST', { moveTo: category.id })).status, 400);
    assert.equal((await request(`/categories/${category.id}/remove`, 'POST', { moveTo: 'endurance' })).status, 200);
    state = await (await request('', 'GET')).json();
    assert.equal(state.categories.some(c => c.id === category.id), false);
    assert.equal(state.goals[0].category, 'endurance'); assert.equal(state.goals[0].archived, true);
    assert.equal(state.goals[0].progress.value, 6); assert.equal(state.goals[0].entries.length, 1);
    assert.equal(createGoalStore(path.join(dir, 'goals.json')).read().removedCategories[0].id, category.id);
    // Empty categories need no reassignment; the last remaining category is protected.
    assert.equal((await request('/categories/strength/remove', 'POST', {})).status, 200);
    assert.equal((await request('/categories/endurance/remove', 'POST', {})).status, 400);
    assert.equal((await request('/categories/strength/restore', 'POST', {})).status, 200);
    assert.equal((await request(`/categories/${category.id}/restore`, 'POST', {})).status, 200);
    state = await (await request('', 'GET')).json();
    assert.equal(state.goals[0].category, category.id); assert.equal(state.goals[0].progress.value, 6);
    assert.equal(state.removedCategories.length, 0); assert.equal(JSON.stringify(activities), before);
    const crossSite = await fetch(origin + '/api/goals/categories', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://elsewhere.example' }, body: '{"name":"Blocked"}' });
    assert.equal(crossSite.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('traverse-goals-test-')) throw new Error('Unexpected test directory');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
