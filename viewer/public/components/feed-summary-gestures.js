export function swipeDirection(dx, dy, threshold = 48) {
  return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx < 0 ? 1 : -1) : 0;
}

// Trackpad momentum belongs to the same gesture: switch only once until it pauses.
export function wheelSwipe(previous, dx, dy, time) {
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return { state: previous, direction: 0 };
  const state = !previous || time - previous.time > 200 ? { distance: 0, switched: false } : { ...previous };
  state.time = time;
  state.distance += dx;
  const direction = state.switched ? 0 : swipeDirection(-state.distance, 0, 72);
  if (direction) state.switched = true;
  return { state, direction };
}
