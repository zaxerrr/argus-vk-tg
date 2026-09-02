const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDigest } = require('../../src/lib/stats');

test('formatDigest renders overview counts without a top-types section when empty', () => {
  const overview = { vk_events_24h: 10, telegram_updates_24h: 5, telegram_sent_24h: 4, errors_24h: 1 };
  const text = formatDigest(overview, []);
  assert.match(text, /События VK: <b>10<\/b>/);
  assert.match(text, /Обновления Telegram: <b>5<\/b>/);
  assert.match(text, /Отправлено сообщений: <b>4<\/b>/);
  assert.match(text, /Ошибок: <b>1<\/b>/);
  assert.doesNotMatch(text, /Топ типов/);
});

test('formatDigest lists top VK event types in order when present', () => {
  const overview = { vk_events_24h: 3, telegram_updates_24h: 0, telegram_sent_24h: 0, errors_24h: 0 };
  const top = [
    { vk_event_type: 'wall_post_new', events: 2 },
    { vk_event_type: 'like_add', events: 1 }
  ];
  const text = formatDigest(overview, top);
  assert.match(text, /Топ типов событий VK:/);
  assert.match(text, /1\. wall_post_new — 2/);
  assert.match(text, /2\. like_add — 1/);
});
