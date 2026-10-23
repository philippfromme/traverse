const DAY = 24 * 60 * 60 * 1000;

export function activityDate(activity) {
  const date = new Date(activity.time);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function day(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, count) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

export function dateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseInputDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, date] = value.split("-").map(Number);
  const result = new Date(year, month - 1, date);
  return dateInputValue(result) === value ? result : null;
}

export function selectedRange(activities, preset, from, to, today = new Date()) {
  const end = day(today);
  if (preset === "custom") {
    const start = parseInputDate(from);
    const finish = parseInputDate(to);
    return start && finish && start <= finish ? { start, end: finish } : null;
  }
  if (preset === "30d") return { start: addDays(end, -29), end };
  if (preset === "90d") return { start: addDays(end, -89), end };
  if (preset === "year") return { start: new Date(end.getFullYear(), 0, 1), end };
  if (preset === "12m") {
    return { start: new Date(end.getFullYear(), end.getMonth() - 11, 1), end };
  }
  const dates = activities.map(activityDate).filter(Boolean).map(day);
  return { start: dates.length ? new Date(Math.min(...dates)) : end, end };
}

export function previousRange(range, preset) {
  if (!range || preset === "all") return null;
  if (preset === "year" || preset === "12m") {
    return {
      start: shiftYear(range.start),
      end: shiftYear(range.end),
    };
  }
  const length = Math.round((range.end - range.start) / DAY) + 1;
  return { start: addDays(range.start, -length), end: addDays(range.start, -1) };
}

function shiftYear(date) {
  const year = date.getFullYear() - 1;
  const lastDay = new Date(year, date.getMonth() + 1, 0).getDate();
  return new Date(year, date.getMonth(), Math.min(date.getDate(), lastDay));
}

export function inRange(activity, range) {
  const date = activityDate(activity);
  return !!date && !!range && date >= range.start && date < addDays(range.end, 1);
}

export function totals(activities) {
  return activities.reduce((sum, activity) => ({
    count: sum.count + 1,
    distance: sum.distance + (activity.distance || 0),
    duration: sum.duration + (activity.duration || 0),
  }), { count: 0, distance: 0, duration: 0 });
}

function bucketStart(date, granularity) {
  if (granularity === "year") return new Date(date.getFullYear(), 0, 1);
  if (granularity === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  return addDays(date, -(date.getDay() + 6) % 7);
}

function nextBucket(date, granularity) {
  if (granularity === "year") return new Date(date.getFullYear() + 1, 0, 1);
  if (granularity === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return addDays(date, 7);
}

function bucketLabel(start, granularity) {
  if (granularity === "year") return String(start.getFullYear());
  if (granularity === "month") return start.toLocaleDateString("en", { month: "short", year: "numeric" });
  return start.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

export function buildBuckets(range, granularity, activities, previousActivities, preset) {
  if (!range) return [];
  const buckets = [];
  const previous = previousRange(range, preset);
  const shift = (date) => {
    if (preset === "year" || preset === "12m") return shiftYear(date);
    const days = Math.round((range.end - range.start) / DAY) + 1;
    return addDays(date, -days);
  };
  let start = bucketStart(range.start, granularity);
  while (start <= range.end) {
    const next = nextBucket(start, granularity);
    const currentStart = new Date(Math.max(start, range.start));
    const currentEnd = new Date(Math.min(next, addDays(range.end, 1)));
    const earlierStart = shift(currentStart);
    const earlierEnd = shift(currentEnd);
    buckets.push({
      label: bucketLabel(start, granularity),
      start: currentStart,
      end: currentEnd,
      current: totals(activities.filter((a) => {
        const date = activityDate(a);
        return date && date >= currentStart && date < currentEnd;
      })),
      previous: previous ? totals(previousActivities.filter((a) => {
        const date = activityDate(a);
        return date && date >= earlierStart && date < earlierEnd;
      })) : null,
    });
    start = next;
  }
  return buckets;
}
