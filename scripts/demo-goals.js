import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { goalTemplates, dayKey } from '../viewer/goals.js';

const directory = process.env.TRAVERSE_DEMO_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error('Set TRAVERSE_DEMO_DIR to an absolute scratch directory.');
const source = process.env.TRAVERSE_DEMO_SOURCE || 'https://traverse.philippfrom.me';
const response = await fetch(new URL('/api/activities', source));
if (!response.ok) throw new Error(`Could not load Traverse activities (${response.status}).`);
const { activities } = await response.json();
if (!Array.isArray(activities)) throw new Error('Traverse did not return an activity list.');
const cache = path.join(directory, 'cache'), data = path.join(directory, 'data');
fs.mkdirSync(cache, { recursive: true }); fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(cache, 'activity-index.json'), JSON.stringify(activities));
fs.writeFileSync(path.join(cache, 'heatmap-data.json'), '{}');
if (!fs.existsSync(path.join(data, 'goals.json'))) {
  const start = dayKey(), end = `${Number(start.slice(0, 4)) + 1}-01-31`;
  fs.writeFileSync(path.join(data, 'goals.json'), JSON.stringify({ version: 1, categories: [{ id: 'endurance', name: 'Endurance' }, { id: 'strength', name: 'Strength' }], goals: goalTemplates(start, end) }, null, 2));
}
console.log(`Demo: ${activities.length} Garmin activities; all goal changes are local to this demo.`);
const child = spawn(process.execPath, ['viewer/server.js'], { stdio: 'inherit', env: { ...process.env, DATA_DIR: data, CACHE_DIR: cache, PORT: process.env.PORT || '4174', OPEN_BROWSER: '0', GOALS_DEMO: '1', GOALS_SOURCE_URL: source } });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', code => process.exit(code || 0));
