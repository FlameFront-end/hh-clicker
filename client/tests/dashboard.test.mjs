import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveList, sourceCount } from '../src/features/main/panels/searchInfo.ts';

test('explicit empty account filters override globals exactly like the server', () => {
  const acc = { resume_hash: 'r', resume_filters: {}, title_include_keywords: [], profile_filter_keys: ['title_include_keywords'] };
  assert.deepEqual(effectiveList(acc, { title_include_keywords: ['frontend'] }, 'title_include_keywords'), { list: [], source: 'profile' });
  assert.deepEqual(effectiveList({ ...acc, profile_filter_keys: [] }, { title_include_keywords: ['frontend'] }, 'title_include_keywords'), { list: ['frontend'], source: 'global' });
});
test('an explicitly empty selected source never means inherit', () => {
  assert.equal(sourceCount({ urls: [], search_source_mode: 'selected' }, { url_pool: ['a', 'b'] }), 0);
  assert.equal(sourceCount({ urls: ['a'], search_source_mode: 'inherit' }, { url_pool: ['a', 'b'] }), 2);
});
import { parseStamp, hhQuota, eventTime, mskDay, profileActive, needsAttention, invitationTotals, applyErrorCount } from '../src/features/main/metrics.ts';

test('submission error counts use correct plural forms', () => {
  for (const [n, word] of [[1, 'ошибка'], [2, 'ошибки'], [5, 'ошибок'], [11, 'ошибок'], [12, 'ошибок'], [21, 'ошибка'], [22, 'ошибки'], [111, 'ошибок']]) {
    assert.equal(applyErrorCount(n), `${n} ${word} отправки`);
  }
  assert.equal(applyErrorCount(1, true), '1 submission error');
  assert.equal(applyErrorCount(2, true), '2 submission errors');
});

const now = Date.parse('2026-10-23T01:00:00Z');
const account = (extra = {}) => ({ idx: 0, temp: true, bot_active: true, hh_user_id: 'user1',
  hh_today_applies: 10, hh_daily_limit: 200, hh_today_applies_updated: '2026-10-23T00:59:00Z', ...extra });

test('ambiguous clock-only values are not parsed as dates', () => {
  assert.equal(parseStamp('13:40:41'), null);
  assert.equal(parseStamp(''), null);
  assert.equal(parseStamp('2026-10-23T07:59:00+07:00'), now - 60000);
  assert.equal(eventTime('', true), 'Date unknown');
});
test('two resumes share one HH allowance and the freshest count', () => {
  const result = hhQuota([account(), account({ idx: 1, hh_today_applies: 9, hh_today_applies_updated: '2026-10-23T00:58:00Z' })], now);
  assert.equal(result.used, 10);
  assert.equal(result.limit, 200);
  assert.equal(result.users, 1);
  assert.equal(result.complete, true);
  assert.equal(result.shared, true);
});

test('invitation counts are per HH user, not per resume', () => {
  const profile = { hh_stats_checked_at: '2026-10-23T00:59:00Z', hh_interviews_recent: 8, hh_interviews: 58 };
  const result = invitationTotals([account(profile), account({ ...profile, idx: 1 })]);
  assert.equal(result.recent, 8);
  assert.equal(result.total, 58);
  assert.equal(result.known, 1);
});
test('missing and stale HH counts are unknown, never a fresh zero', () => {
  for (const stamp of ['', '13:40:41', '2026-10-23T00:40:00Z', '2026-10-22T20:59:00Z']) {
    assert.equal(hhQuota([account({ hh_today_applies_updated: stamp })], now).complete, false);
  }
  assert.equal(hhQuota([account({ hh_today_applies: 0 })], now).complete, true);
});
test('partial quota never pretends to be the total', () => {
  const q = hhQuota([account(), account({ idx: 1, hh_user_id: 'user2', hh_today_applies_updated: '' })], now);
  assert.equal(q.complete, false);
  assert.equal(q.known, 1);
  assert.equal(q.users, 2);
});
test('stopped profiles do not inflate allowance and cannot appear running', () => {
  const stopped = account({ idx: 2, bot_active: false, hh_user_id: 'other' });
  assert.equal(profileActive(stopped), false);
  assert.equal(hhQuota([account(), stopped], now).users, 1);
});
test('unknown user identities are explicitly marked instead of silently deduplicated', () => {
  assert.equal(hhQuota([account({ hh_user_id: '' })], now).unidentified, true);
});
test('Moscow calendar dates are independent of browser location', () => {
  assert.equal(mskDay(Date.parse('2026-10-22T21:00:00Z')), '2026-10-23');
  assert.equal(mskDay(Date.parse('2026-10-23T04:00:00+07:00')), '2026-10-23');
});
test('protective holds and worker errors need attention, regular waits do not', () => {
  assert.equal(needsAttention(account({ paused_reason: 'captcha' })), true);
  assert.equal(needsAttention(account({ status: 'error' })), true);
  assert.equal(needsAttention(account({ status: 'waiting', paused_reason: '' })), false);
});
