import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeLoa, consequenceAllowed, validatePeriod, evaluate } from '../src/domain.js';
const start = new Date('2026-10-01T00:00:00Z'), end = new Date('2026-10-08T00:00:00Z');
const staff = (status = 'approved') => ({ strikes: 2, events: [{ type: 'loa', source: 'series', status, start: '2026-10-03', end: '2026-10-04' }] });
test('retired local LOAs do not grant a Series quota exemption', () => {
  const s = staff(); delete s.events[0].source;
  assert.equal(activeLoa(s, start, end), false);
});
test('approved LOA exempts an overlapping historical quota period', () => {
  assert.equal(activeLoa(staff(), start, end), true);
  assert.throws(() => consequenceAllowed(staff(), true, start, end), /LOA/);
  assert.doesNotThrow(() => consequenceAllowed(staff(), false));
});
test('pending and denied LOAs do not exempt staff', () => {
  for (const status of ['pending', 'denied']) assert.equal(activeLoa(staff(status), start, end), false);
});
test('five strikes or terminated records block new consequences', () => {
  assert.throws(() => consequenceAllowed({ strikes: 5, events: [] }, false), /TERMINATION REQUIRED/);
  assert.throws(() => consequenceAllowed({ strikes: 1, terminatedAt: new Date() }, false), /terminated/);
  assert.doesNotThrow(() => consequenceAllowed({ strikes: 4, events: [] }, false));
});
test('Series missing metrics never count as quota failures', () => {
  const requirements = [{ metric: 'sessions', target: 3 }];
  for (const metrics of [{}, { sessions: NaN }, { sessions: -1 }, { sessions: '3' }]) assert.throws(() => evaluate(requirements, metrics));
  assert.equal(evaluate(requirements, { sessions: 3 })[0].complete, true);
  assert.equal(evaluate(requirements, { sessions: 2 })[0].complete, false);
});
test('date periods reject invalid or reversed dates', () => {
  assert.throws(() => validatePeriod('bad', '2026-10-01'));
  assert.throws(() => validatePeriod('2026-10-08', '2026-10-01'));
  assert.equal(validatePeriod(start, end).end.toISOString(), end.toISOString());
});
