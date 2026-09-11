const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDigest } = require('../../src/lib/stats');

test('formatDigest shows only non-zero overview counters', () => {
  const overview = { vk_events_24h: 10, telegram_updates_24h: 0, telegram_sent_24h: 4, errors_24h: 0 };
  const text = formatDigest(overview, []);
  assert.match(text, /События VK: <b>10<\/b>/);
  assert.match(text, /Отправлено сообщений: <b>4<\/b>/);
  assert.doesNotMatch(text, /Обновления Telegram/);
  assert.doesNotMatch(text, /Ошибок/);
  assert.doesNotMatch(text, /По типам событий/);
});

test('formatDigest reports "no events" when everything is zero and no types occurred', () => {
  const overview = { vk_events_24h: 0, telegram_updates_24h: 0, telegram_sent_24h: 0, errors_24h: 0 };
  const text = formatDigest(overview, []);
  assert.match(text, /Событий не было\./);
  assert.doesNotMatch(text, /<b>0<\/b>/);
});

test('formatDigest lists VK event types with friendly labels and counts, no zero padding', () => {
  const overview = { vk_events_24h: 3, telegram_updates_24h: 0, telegram_sent_24h: 0, errors_24h: 0 };
  const top = [
    { vk_event_type: 'like_add', events: 5 },
    { vk_event_type: 'message_new', events: 10 },
  ];
  const text = formatDigest(overview, top);
  assert.match(text, /По типам событий VK:/);
  assert.match(text, /Лайки: <b>5<\/b>/);
  assert.match(text, /Сообщения: <b>10<\/b>/);
});

test('formatDigest falls back to the raw type string for an unmapped VK event type', () => {
  const overview = { vk_events_24h: 1, telegram_updates_24h: 0, telegram_sent_24h: 0, errors_24h: 0 };
  const top = [{ vk_event_type: 'some_new_type', events: 1 }];
  const text = formatDigest(overview, top);
  assert.match(text, /some_new_type: <b>1<\/b>/);
});
