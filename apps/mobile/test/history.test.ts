/**
 * The value history: one point a day, and honest about how little it knows.
 *
 * The failure mode worth guarding is not a wrong pixel, it is a confident
 * number. A collection recorded twice today must not report a monthly change,
 * and a chart drawn from one point must not be drawn at all.
 *
 *   node --experimental-strip-types apps/mobile/test/history.test.ts
 */

import { changeOver, dayOf, record, spark, type Point } from '../src/history.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const DAY = 86400000;
const t0 = Date.parse('2026-06-01T12:00:00');

// Several recordings on one day collapse to one point, holding the latest.
{
  let p: Point[] = [];
  p = record(p, 100, 5, t0);
  p = record(p, 140, 7, t0 + 3600000);
  p = record(p, 155, 8, t0 + 7200000);
  check('one point per day', p.length === 1, `${p.length} points`);
  check('the day holds the latest value', p[0].value === 155 && p[0].cards === 8,
    JSON.stringify(p[0]));
}

// Recording the same numbers again returns the same array, so nothing re-renders.
{
  let p: Point[] = record([], 100, 5, t0);
  const again = record(p, 100, 5, t0 + 60000);
  check('an unchanged total is not a new array', again === p);
}

// Days accumulate.
{
  let p: Point[] = [];
  for (let d = 0; d < 5; d++) p = record(p, 100 + d * 10, 5 + d, t0 + d * DAY);
  check('five days make five points', p.length === 5, `${p.length}`);
  check('they are in order', p.map((x) => x.day).join(',') ===
    [0, 1, 2, 3, 4].map((d) => dayOf(t0 + d * DAY)).join(','));
}

// A single point cannot produce a change or a chart.
{
  const p = record([], 100, 5, t0);
  check('no change from one point', changeOver(p, 7, t0) === null);
  check('no sparkline from one point', spark(p).length === 0);
}

// A real change, measured against a real earlier day.
{
  let p: Point[] = [];
  p = record(p, 100, 5, t0);
  p = record(p, 130, 6, t0 + 3 * DAY);
  const c = changeOver(p, 7, t0 + 3 * DAY);
  check('change is measured', c !== null && c.delta === 30, JSON.stringify(c));
  check('as a fraction too', c !== null && Math.abs((c.fraction ?? 0) - 0.3) < 1e-9,
    JSON.stringify(c?.fraction));
  check('and reports the span it rests on', c !== null && c.span === 3, `${c?.span}`);
}

/*
 * A window longer than the history falls back to the earliest point, and says
 * so through `span`. This is the case that would otherwise quietly present two
 * days of data as a month's performance.
 */
{
  let p: Point[] = [];
  p = record(p, 200, 4, t0);
  p = record(p, 260, 5, t0 + 2 * DAY);
  const c = changeOver(p, 30, t0 + 2 * DAY);
  check('a 30-day window on 2 days of history still answers', c !== null);
  check('but reports a 2-day span, not 30', c !== null && c.span === 2, `${c?.span}`);
}

// A collection that started at zero has no meaningful percentage.
{
  let p: Point[] = [];
  p = record(p, 0, 0, t0);
  p = record(p, 50, 2, t0 + DAY);
  const c = changeOver(p, 7, t0 + DAY);
  check('no percentage from a zero base', c !== null && c.fraction === null,
    JSON.stringify(c));
}

// The sparkline is normalised, in range, and never a flat line on the floor.
{
  let p: Point[] = [];
  for (let d = 0; d < 20; d++) p = record(p, 100, 3, t0 + d * DAY);
  const s = spark(p);
  const inRange = s.every((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1);
  check('a flat history is drawn in range', s.length === 20 && inRange);
  check('and sits off the floor', s.every((q) => q.y > 0.2 && q.y < 0.8),
    `y values ${s[0]?.y}`);
}

{
  let p: Point[] = [];
  for (let d = 0; d < 200; d++) p = record(p, 100 + d, 3, t0 + d * DAY);
  const s = spark(p, 40);
  check('a long history is downsampled', s.length === 40, `${s.length}`);
  check('rising values rise on the chart', s[0].y < s[s.length - 1].y);
  check('x spans the full width', s[0].x === 0 && Math.abs(s[s.length - 1].x - 1) < 1e-9);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
