export const berlinDay = value => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k).value).join('-');
};
export const raceDate = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
export const raceDates = r => raceDate(r.startDate) + (r.endDate !== r.startDate ? ' – ' + raceDate(r.endDate) : '') + (r.dateConfirmed ? '' : ' · tentative');
export const countdown = r => r.daysUntilEnd < 0 ? 'Past race' : r.daysUntil <= 0 ? (r.daysUntilEnd === 0 ? 'Today' : 'Race window open') : r.startDate === r.endDate ? `${r.daysUntil} days to go` : `${r.daysUntil}–${r.daysUntilEnd} days to go`;
export const number = n => n == null ? '—' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: 1 });
export const raceTime = seconds => seconds == null ? '—' : `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;
