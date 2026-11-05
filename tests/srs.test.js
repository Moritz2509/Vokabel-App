import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as srs from '../js/srs.js';

const { RATING, DAY, MINUTE } = srs;
const T0 = Date.UTC(2026, 0, 1);

test('neue Karte: "Gut" -> 1 Tag, "Leicht" -> 4 Tage', () => {
  const good = srs.review(srs.newSrs(T0), RATING.GOOD, T0);
  assert.equal(good.state, 'review');
  assert.equal(good.due - T0, 1 * DAY);
  const easy = srs.review(srs.newSrs(T0), RATING.EASY, T0);
  assert.equal(easy.due - T0, 4 * DAY);
});

test('"Schwer" bei neuer Karte bleibt in der Lernphase (10 Min)', () => {
  const s = srs.review(srs.newSrs(T0), RATING.HARD, T0);
  assert.equal(s.state, 'learning');
  assert.equal(s.due - T0, 10 * MINUTE);
  assert.equal(s.streak, 1);
});

test('gewusste Karten kommen immer seltener', () => {
  let s = srs.newSrs(T0);
  let t = T0;
  const intervals = [];
  for (let i = 0; i < 6; i++) {
    s = srs.review(s, RATING.GOOD, t);
    intervals.push(Math.round((s.due - t) / DAY));
    t = s.due;
  }
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1], intervals.join(','));
  assert.ok(intervals.at(-1) >= 60, `nach 6× gewusst: ${intervals.at(-1)} Tage`);
});

test('vergessene Karte kommt sofort wieder und wird schwerer', () => {
  let s = srs.newSrs(T0);
  s = srs.review(s, RATING.GOOD, T0);
  s = srs.review(s, RATING.GOOD, s.due);
  const before = s.ease;
  const t = s.due;
  s = srs.review(s, RATING.AGAIN, t);
  assert.equal(s.state, 'learning');
  assert.equal(s.due - t, 1 * MINUTE);
  assert.equal(s.lapses, 1);
  assert.ok(s.ease < before);
  assert.equal(s.interval, 0);
});

test('Leicht wächst schneller als Gut, Schwer langsamer', () => {
  let base = srs.review(srs.newSrs(T0), RATING.GOOD, T0);
  base = srs.review(base, RATING.GOOD, base.due);
  const t = base.due;
  const [, hard, good, easy] = srs.preview(base, t);
  assert.ok(hard < good && good < easy, `${hard} ${good} ${easy}`);
});

test('Ease fällt nie unter 1.3', () => {
  let s = srs.review(srs.newSrs(T0), RATING.GOOD, T0);
  for (let i = 0; i < 20; i++) {
    s = srs.review(s, RATING.AGAIN, T0);
    s = srs.review(s, RATING.GOOD, T0);
  }
  assert.ok(s.ease >= 1.3);
});

test('dueQueue: fällige zuerst, dann begrenzt neue', () => {
  const mk = (id, state, due, createdAt = 0) => ({ id, createdAt, srs: { ...srs.newSrs(T0), state, due } });
  const cards = [
    mk('n1', 'new', T0, 1),
    mk('n2', 'new', T0, 2),
    mk('n3', 'new', T0, 3),
    mk('r-later', 'review', T0 + DAY),
    mk('r-old', 'review', T0 - 2 * DAY),
    mk('r-new', 'review', T0 - DAY),
  ];
  const q = srs.dueQueue(cards, T0, 2).map((c) => c.id);
  assert.deepEqual(q, ['r-old', 'r-new', 'n1', 'n2']);
});

test('Session: falsche Karte kommt nach 3 anderen wieder', () => {
  const s = new srs.Session(['a', 'b', 'c', 'd', 'e']);
  s.next(false, true, 3); // a falsch
  assert.deepEqual(s.queue, ['b', 'c', 'd', 'a', 'e']);
  s.next(true, false);
  s.next(true, false);
  s.next(true, false);
  assert.equal(s.current, 'a');
  s.next(true, false);
  s.next(true, false);
  assert.ok(s.done);
  assert.equal(s.firstTryCorrect, 4);
  assert.deepEqual([...s.mistakes], ['a']);
  assert.equal(s.progress, 1);
});

test('mastery-Stufen', () => {
  assert.equal(srs.mastery(srs.newSrs()), 0);
  assert.equal(srs.mastery({ state: 'learning', interval: 0 }), 1);
  assert.equal(srs.mastery({ state: 'review', interval: 3 }), 1);
  assert.equal(srs.mastery({ state: 'review', interval: 10 }), 2);
  assert.equal(srs.mastery({ state: 'review', interval: 30 }), 3);
});

test('formatInterval', () => {
  assert.equal(srs.formatInterval(MINUTE), '1 Min');
  assert.equal(srs.formatInterval(10 * MINUTE), '10 Min');
  assert.equal(srs.formatInterval(DAY), '1 Tag');
  assert.equal(srs.formatInterval(4 * DAY), '4 Tage');
  assert.equal(srs.formatInterval(90 * DAY), '3 Mon');
});
