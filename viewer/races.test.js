import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { validateRace, createRaceStore, registerRaces } from './races.js';
import { runningStats, raceOverview, racePhases, raceCalendar, dayKey } from './race-planning.js';
import { berlinDay, countdown } from './public/components/race-utils.js';

const base = { name: 'Half marathon', startDate: '2027-04-04', distanceMeters: 21097.5 };
const run = (id, time, distance = 10000, extra = {}) => ({ id, time, type: 'running', distance, duration: 3600, ...extra });
const state = races => ({ races, settings: { targetRaceId: races[0]?.id || null, weeklyDistanceKm: null, runDays: 3 } });
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-races-test-'));
function cleanup(dir) { if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('traverse-races-test-')) throw new Error('Unexpected scratch directory'); fs.rmSync(dir, { recursive: true, force: true }); }

test('race input validates dates, measurements, status and safe organiser links', () => {
  const r = validateRace(base);
  assert.equal(r.endDate, base.startDate); assert.equal(r.dateConfirmed, true); assert.equal(r.distanceMeters, 21097.5);
  assert.throws(() => validateRace({ ...base, startDate: '2027-02-30' }), /valid race dates/);
  assert.throws(() => validateRace({ ...base, endDate: '2027-04-03' }), /valid race dates/);
  for (const value of [0, -1, Infinity, 'not a number']) assert.throws(() => validateRace({ ...base, distanceMeters: value }), /distance/);
  for (const website of ['javascript:alert(1)', 'https://user:pass@example.com', 'broken']) assert.throws(() => validateRace({ ...base, website }), /URL/);
  assert.throws(() => validateRace({ ...base, outcome: 'yes' }), /status/);
  assert.throws(() => validateRace({ ...base, targetTimeSeconds: 0 }), /target time/);
  assert.ok(!validateRace({ ...base, website: 'https://example.com/\r\nATTENDEE:bad' }).website.includes('\n'));
  const window = validateRace({ ...base, endDate: '2027-04-05', dateConfirmed: true }); assert.equal(window.dateConfirmed, false);
});

test('running statistics use eight complete Berlin weeks, retain zero weeks and deduplicate IDs', () => {
  const activities = [run('a', '2026-10-18T12:00:00Z'), run('a', '2026-10-18T12:00:00Z'), run('current', '2026-10-18T22:30:00Z', 50000), run('bad', '2026-10-16T12:00:00Z', null), run('ride', '2026-10-17T12:00:00Z', 999999, { type: 'cycling' }), run('old', '2026-09-20T12:00:00Z')];
  const s = runningStats(activities, new Date('2026-10-19T12:00:00Z'));
  assert.equal(s.start, '2026-09-21'); assert.equal(s.end, '2026-10-18'); assert.equal(s.averageKm, 2.5); assert.equal(s.lastWeek.km, 10); assert.equal(s.longestKm, 10); assert.equal(s.missingDistances, 1); assert.equal(s.series.length, 8);
  assert.equal(runningStats([], new Date('2026-10-19')).available, false);
  assert.equal(runningStats([run('bike', '2026-10-18', 20000, { type: 'cycling' })], new Date('2026-10-19')).averageKm, 0);
  assert.equal(dayKey('2026-10-25T23:30:00Z'), '2026-10-26'); assert.equal(berlinDay('2026-10-25T23:30:00Z'), '2026-10-26');
  assert.equal(runningStats([run('dst', '2026-10-25T23:30:00Z')], new Date('2026-10-26T12:00:00Z')).lastWeek.km, 0);
});

test('next race is independent of target, while past and cancelled targets generate no sessions', () => {
  const target = validateRace(base), side = validateRace({ ...base, name: 'Side race', startDate: '2027-03-28' });
  const data = state([target, side]); data.settings.weeklyDistanceKm = 18;
  const d = raceOverview(data, [], new Date('2026-12-31T12:00:00Z'));
  assert.equal(d.nextRace.id, side.id); assert.equal(d.target.id, target.id); assert.equal(d.conflicts[0].days, -7); assert.equal(d.sessions.reduce((n, s) => n + s.km, 0), 18);
  const taper = raceOverview(data, [], new Date('2027-03-28T12:00:00Z')); assert.equal(taper.phase, 'Taper'); assert.equal(taper.sessions.reduce((n, s) => n + s.km, 0), 11.7);
  assert.equal(raceOverview(data, [], new Date('2027-04-04T12:00:00Z')).sessions.length, 0);
  assert.equal(raceOverview(data, [], new Date('2027-04-05T12:00:00Z')).target, null);
  target.outcome = 'cancelled'; assert.equal(raceOverview(data, [], new Date('2027-01-01')).target, null);
});

test('preparation windows reproduce the reference distance rules and tentative countdowns remain windows', () => {
  const phases = racePhases(validateRace(base));
  assert.equal(phases[0].start, '2026-10-18'); assert.equal(phases[0].end, '2027-01-10'); assert.equal(phases[3].start, '2027-03-21');
  const short = racePhases(validateRace({ ...base, distanceMeters: 10000 })); assert.equal(short[0].end, '2027-02-07'); assert.equal(short[3].start, '2027-03-28');
  const race = validateRace({ ...base, startDate: '2027-09-11', endDate: '2027-09-12' });
  const data = raceOverview(state([race]), [], new Date('2027-09-10T12:00:00Z')); assert.equal(countdown(data.nextRace), '1–2 days to go');
  assert.equal(countdown(raceOverview(state([race]), [], new Date('2027-09-11T12:00:00Z')).nextRace), 'Race window open');
});

test('ICS uses stable IDs, exclusive end dates, Unicode folding and escaped notes', () => {
  const r = validateRace({ ...base, name: 'Ä'.repeat(100) + ', Run', notes: 'A;B\nC\\D', startDate: '2027-09-11', endDate: '2027-09-12' });
  const ics = raceCalendar([r]), unfolded = ics.replace(/\r\n /g, '');
  assert.match(ics, /DTEND;VALUE=DATE:20270913/); assert.match(ics, /STATUS:TENTATIVE/);
  assert.ok(unfolded.includes('A\\;B\\nC\\\\D')); assert.ok(unfolded.includes('\\, Run'));
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.ok(raceCalendar([{ ...r, name: 'Changed' }]).includes(`UID:${r.id}@traverse`));
  assert.ok(!raceCalendar([{ ...r, archived: true }]).includes('BEGIN:VEVENT'));
});

test('store serializes concurrent writes, survives reopening and preserves damaged files', async () => {
  const dir = scratch(), filename = path.join(dir, 'races.json');
  try {
    const store = createRaceStore(filename);
    await Promise.all(Array.from({ length: 8 }, () => store.mutate(d => d.races.push(validateRace(base)))));
    assert.equal(createRaceStore(filename).read().races.length, 8);
    fs.writeFileSync(filename, '{damaged'); await assert.rejects(store.mutate(d => { d.races = []; })); assert.equal(fs.readFileSync(filename, 'utf8'), '{damaged');
  } finally { cleanup(dir); }
});

test('API handles planning, archive/restore, linked results, validation and persistence without modifying activities', async () => {
  const dir = scratch(), app = express(); let activities = [run('completed', '2026-10-18T10:00:00Z')];
  const original = JSON.stringify(activities);
  registerRaces(app, { dataDir: dir, getActivities: () => activities, now: () => new Date('2026-10-19T12:00:00Z') });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://localhost:${server.address().port}/api/races`;
  const request = (suffix = '', method = 'GET', body, headers = {}) => fetch(url + suffix, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const created = await request('', 'POST', base); assert.equal(created.status, 201); const race = await created.json();
    assert.equal((await request('/settings', 'PUT', { targetRaceId: race.id, weeklyDistanceKm: 18, runDays: 3 })).status, 200);
    assert.equal((await request('/settings', 'PUT', { targetRaceId: 'missing' })).status, 400);
    assert.equal((await request('/settings', 'PUT', { runDays: 6 })).status, 400);
    assert.equal((await request(`/${race.id}`, 'PUT', { activityId: 'missing' })).status, 400);
    assert.equal((await request(`/${race.id}`, 'PUT', { activityId: 'completed' })).status, 200);
    let data = await (await request('?year=2027')).json(); assert.equal(data.races[0].result.id, 'completed'); assert.equal(data.races[0].outcome, 'planned'); assert.ok(data.years.includes(2027));
    assert.equal((await request(`/${race.id}`, 'PUT', { archived: true })).status, 200);
    assert.equal((await (await request('/overview')).json()).target, null);
    assert.equal((await request(`/${race.id}`, 'PUT', { archived: false })).status, 200);
    assert.equal((await request('/settings', 'PUT', { targetRaceId: race.id })).status, 200);
    activities = []; data = await (await request()).json(); assert.equal(data.races[0].activityId, 'completed'); assert.equal(data.races[0].result, null);
    assert.equal((await request(`/${race.id}`, 'PUT', { name: 'Preserve missing link' })).status, 200);
    assert.equal((await request(`/${race.id}`, 'PUT', { outcome: 'cancelled' })).status, 200);
    assert.equal(createRaceStore(path.join(dir, 'races.json')).read().settings.targetRaceId, null);
    assert.equal((await request('?year=bad')).status, 400); assert.equal((await request('', 'POST', base, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await request('', 'POST', base, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request('/missing', 'PUT', {})).status, 404);
    assert.equal((await request('/templates/berlin-2027', 'POST', {})).status, 200);
    assert.equal((await (await request('/templates/berlin-2027', 'POST', {})).json()).added, 0);
    const seeded = createRaceStore(path.join(dir, 'races.json')).read();
    assert.equal(seeded.races.length, 7); assert.equal(seeded.races.filter(r => r.templateKey && !r.dateConfirmed).length, 1);
    const template = seeded.races.find(r => r.templateKey);
    await request(`/${template.id}`, 'PUT', { name: 'Edited template', startDate: '2027-04-05', endDate: '2027-04-05', archived: true });
    assert.equal((await (await request('/templates/berlin-2027', 'POST', {})).json()).added, 0);
    assert.equal((await request('/calendar.ics?year=2027')).headers.get('content-type').split(';')[0], 'text/calendar');
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
    assert.equal(JSON.stringify([run('completed', '2026-10-18T10:00:00Z')]), original);
  } finally { await new Promise(resolve => server.close(resolve)); cleanup(dir); }
});
