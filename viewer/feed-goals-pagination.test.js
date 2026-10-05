import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateGoals } from './public/components/feed-goals-pagination.js';

test('repeats category headings after a page break and keeps every goal', () => {
  const items = Array.from({length:7}, (_, i) => ({id:String(i), category:i < 2 ? 'endurance' : 'strength', height:50}));
  const headings = {endurance:30, strength:30};
  assert.deepEqual(paginateGoals(items, 270, headings, 12, 4), [['0','1','2'], ['3','4','5','6']]);
  assert.deepEqual(paginateGoals(items, 500, headings, 12, 4), [items.map(item => item.id)]);
});

test('fits varying row heights and many categories without skipping or duplicating goals', () => {
  const items = Array.from({length:80}, (_, i) => ({id:String(i), category:'category-' + Math.floor(i / 4), height:i % 3 ? 50 : 72}));
  const headings = Object.fromEntries(items.map(item => [item.category, 32]));
  for (const available of [180, 320, 600]) {
    const pages = paginateGoals(items, available, headings, 12, 4);
    assert.deepEqual(pages.flat(), items.map(item => item.id));
    for (const page of pages) {
      let height = 0, category = null;
      for (const id of page) {
        const item = items[Number(id)];
        height += item.height + (category === item.category ? 4 : (height ? 12 : 0) + headings[item.category]);
        category = item.category;
      }
      assert.ok(height <= available, `Page of ${height}px exceeds ${available}px`);
    }
  }
});

test('uses the full available height and handles an empty overview', () => {
  const items = [{id:'a',category:'strength',height:50}, {id:'b',category:'strength',height:50}];
  assert.deepEqual(paginateGoals(items, 134, {strength:30}, 12, 4), [['a','b']]);
  assert.deepEqual(paginateGoals(items, 133, {strength:30}, 12, 4), [['a'],['b']]);
  assert.deepEqual(paginateGoals([], 400, {}, 12, 4), []);
});
