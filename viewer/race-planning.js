import { dayKey, shiftDay, weekStart } from './goals.js';

export { dayKey };
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
export const activeRace = r => !r.archived && r.outcome === 'planned';

export function runningStats(activities, now = new Date()) {
  const today = dayKey(now), end = shiftDay(weekStart(today), -1);
  const unique = [...new Map((activities || []).filter(a => a.id).map(a => [a.id, a])).values()];
  const dated = unique.filter(a => a.time).map(a => ({ ...a, date: dayKey(a.time) }));
  const runs = dated.filter(a => a.type === 'running' && a.date && a.date <= today);
  const series = Array.from({ length: 8 }, (_, i) => {
    const start = shiftDay(end, -55 + i * 7), last = shiftDay(start, 6);
    const selected = runs.filter(a => a.date >= start && a.date <= last);
    const measured = selected.filter(a => Number.isFinite(a.distance) && a.distance >= 0);
    return { start, end: last, km: measured.reduce((n, a) => n + a.distance / 1000, 0), count: selected.length, missingDistances: selected.length - measured.length };
  });
  const recent = runs.filter(a => a.date >= series[4].start && a.date <= end);
  const distances = recent.filter(a => Number.isFinite(a.distance) && a.distance >= 0).map(a => a.distance / 1000);
  return { available: Array.isArray(activities) && activities.length > 0, start: series[4].start, end, series,
    averageKm: series.slice(4).reduce((n, w) => n + w.km, 0) / 4, lastWeek: series.at(-1),
    longestKm: Math.max(0, ...distances), missingDistances: recent.length - distances.length,
    latestActivity: dated.filter(a => a.date && a.date <= today).map(a => a.time).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null };
}

// Explicit, versioned planning rules. These are preparation windows, not a fitness prediction.
export function racePhases(race) {
  const long = race.distanceMeters > 10000;
  const weeks = long ? [12, 6, 4, 2] : [16, 4, 3, 1];
  let cursor = race.startDate;
  return ['Base', 'Build', 'Race-specific', 'Taper'].map((name, i) => ({ name, weeks: weeks[i], key: ['base', 'build', 'specific', 'taper'][i] })).reverse().map(p => {
    const end = cursor; cursor = shiftDay(end, -p.weeks * 7);
    return { ...p, start: cursor, end };
  }).reverse();
}

export function raceOverview(data, activities, now = new Date()) {
  const today = dayKey(now), stats = runningStats(activities, now);
  const decorate = r => ({ ...r, daysUntil: daysBetween(today, r.startDate), daysUntilEnd: daysBetween(today, r.endDate), phases: racePhases(r),
    result: r.activityId ? (activities || []).find(a => a.id === r.activityId && a.type === 'running') || null : null });
  const races = data.races.map(decorate).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  const upcoming = races.filter(r => activeRace(r) && r.endDate >= today);
  const target = upcoming.find(r => r.id === data.settings.targetRaceId) || null;
  const phase = target?.phases.find(p => p.start <= today && today < p.end)?.name || (target ? (target.startDate <= today ? 'Race day' : 'Before preparation') : null);
  const conflicts = target ? upcoming.filter(r => r.id !== target.id && Math.abs(daysBetween(target.startDate, r.startDate)) <= 14).map(r => ({ id: r.id, name: r.name, days: daysBetween(target.startDate, r.startDate) })) : [];
  const baselineKm = data.settings.weeklyDistanceKm ?? (stats.available ? stats.lastWeek.km : null);
  const km = baselineKm == null ? null : baselineKm * (phase === 'Taper' ? 0.65 : 1);
  const count = data.settings.runDays;
  const weights = { 2: [0.4, 0.6], 3: [0.23, 0.33, 0.44], 4: [0.2, 0.25, 0.2, 0.35], 5: [0.15, 0.2, 0.15, 0.2, 0.3] }[count];
  const weekdays = { 2: ['Wed', 'Sun'], 3: ['Tue', 'Thu', 'Sun'], 4: ['Tue', 'Thu', 'Sat', 'Sun'], 5: ['Mon', 'Tue', 'Thu', 'Sat', 'Sun'] }[count];
  let used = 0;
  const sessions = target && km > 0 && target.startDate > today ? weights.map((w, i) => {
    const distance = i === count - 1 ? Math.round((km - used) * 10) / 10 : Math.round(km * w * 10) / 10;
    used += distance;
    return { day: weekdays[i], title: i === count - 1 ? 'Long easy run' : 'Easy run', km: distance };
  }) : [];
  return { today, races, settings: data.settings, stats, nextRace: upcoming[0] || null, target, phase, conflicts, sessions, planningModel: 1 };
}

const escapeICS = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function fold(line) {
  let out = '', chunk = '', bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > 75) { out += chunk + '\r\n'; chunk = ' '; bytes = 1; }
    chunk += ch; bytes += size;
  }
  return out + chunk;
}
export function raceCalendar(races) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Traverse//Races//EN', 'CALSCALE:GREGORIAN'];
  for (const r of races.filter(r => !r.archived && r.outcome !== 'cancelled')) {
    lines.push('BEGIN:VEVENT', `UID:${r.id}@traverse`, `DTSTAMP:${new Date(r.updatedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;VALUE=DATE:${r.startDate.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${shiftDay(r.endDate, 1).replaceAll('-', '')}`,
      `SUMMARY:${escapeICS(r.name)}`, `LOCATION:${escapeICS(r.location)}`, `DESCRIPTION:${escapeICS(`${r.distanceMeters / 1000} km${r.dateConfirmed ? '' : ' · Date to be confirmed'}\n${r.notes}`)}`,
      `STATUS:${r.dateConfirmed ? 'CONFIRMED' : 'TENTATIVE'}`, ...(r.website ? [`URL:${r.website}`] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
