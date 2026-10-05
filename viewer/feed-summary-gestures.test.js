import test from 'node:test';
import assert from 'node:assert/strict';
import { swipeDirection, wheelSwipe } from './public/components/feed-summary-gestures.js';

test('swipes change one page in the matching direction', () => {
  assert.equal(swipeDirection(-120, 8), 1);
  assert.equal(swipeDirection(120, -8), -1);
});

test('taps, short drags and vertical or diagonal scrolling do not change pages', () => {
  for (const [dx, dy] of [[0,0], [30,2], [10,120], [80,90], [90,70]]) assert.equal(swipeDirection(dx,dy), 0);
});

test('trackpad momentum changes only one page and a new gesture can reverse it', () => {
  let state, changes = [];
  for (const [dx, time] of [[30,0],[30,30],[30,60],[100,90],[50,120]]) {
    const result = wheelSwipe(state,dx,0,time);
    state = result.state;
    if (result.direction) changes.push(result.direction);
  }
  assert.deepEqual(changes,[1]);
  assert.equal(wheelSwipe(state,-100,0,400).direction,-1);
});

test('vertical trackpad scrolling passes through without changing pages', () => {
  assert.deepEqual(wheelSwipe(undefined,4,100,0), {state:undefined,direction:0});
});
