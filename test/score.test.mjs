// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/score.js';

const { bayesian, parseCount, parseRating, rank } = globalThis.AmaZoom.score;

test('parseCount handles Amazon formats', () => {
  assert.equal(parseCount('12,345'), 12345);
  assert.equal(parseCount('(12.3K)'), 12300);
  assert.equal(parseCount('1.2M ratings'), 1200000);
  assert.equal(parseCount('12K+'), 12000);
  assert.equal(parseCount('(87)'), 87);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount('no digits'), null);
});

test('parseRating reads "x out of 5 stars"', () => {
  assert.equal(parseRating('4.5 out of 5 stars'), 4.5);
  assert.equal(parseRating('4.5 out of 5 stars, rating details'), 4.5);
  assert.equal(parseRating('5 out of 5'), 5);
  assert.equal(parseRating('Sponsored'), null);
});

test('a few perfect ratings lose to many very good ones', () => {
  assert.ok(bayesian(4.7, 3000) > bayesian(5.0, 3));
  assert.ok(bayesian(4.7, 3000) > bayesian(4.9, 40));
});

test('volume alone does not beat quality', () => {
  assert.ok(bayesian(4.6, 2000) > bayesian(4.2, 50000));
});

test('missing data gives no score', () => {
  assert.equal(bayesian(null, 100), null);
  assert.equal(bayesian(4.5, 0), null);
});

test('rank puts unscored items last and is stable', () => {
  const items = [
    { asin: 'a', score: null, count: null, order: 1 },
    { asin: 'b', score: 4.1, count: 10, order: 2 },
    { asin: 'c', score: 4.6, count: 5, order: 3 },
    { asin: 'd', score: 4.1, count: 99, order: 4 },
  ];
  assert.deepEqual(rank(items, 'best').map((i) => i.asin), ['c', 'b', 'd', 'a']);
  assert.deepEqual(rank(items, 'count').map((i) => i.asin), ['d', 'b', 'c', 'a']);
  assert.deepEqual(rank(items, 'amazon').map((i) => i.asin), ['a', 'b', 'c', 'd']);
});
