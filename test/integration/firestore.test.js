// Интеграционный тест против эмулятора Firestore. Пропускается, если FIRESTORE_EMULATOR_HOST
// не задан (обычный `npm test` и CI его не требуют). Запуск:
//   npx firebase-tools emulators:start --only firestore   (нужна Java)
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --require ./test/setupEnv.js --test test/integration/
const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
const opts = { skip: enabled ? false : 'FIRESTORE_EMULATOR_HOST не задан' };

test('Firestore: логгер, статистика, дедуп и состояние работают с настоящим клиентом', opts, async () => {
  const { db } = require('../../src/lib/db');
  const { logger } = require('../../src/lib/logger');
  const { getOverview24h, getTopVkEventTypes } = require('../../src/lib/stats');
  const { shouldProcessEvent, rememberEvent } = require('../../src/vk/dedup');
  const { loadState, saveState } = require('../../src/lib/stateStore');

  const runId = `it-${Date.now()}`;

  // 1. Пакет логов с «ядовитым» payload (вложенный массив, undefined) целиком доходит до базы.
  logger.info({ source: 'vk', event: 'incoming_update', request_id: `${runId}-a`,
    payload: { type: 'message_reply', object: { keyboard: { buttons: [[{ a: 1 }]] }, x: undefined } } });
  logger.info({ source: 'vk', event: 'processed_event', request_id: `${runId}-b`, payload: { type: 'like_add' } });
  await logger.flush();
  const logs = await db.collection('bot_logs').where('request_id', 'in', [`${runId}-a`, `${runId}-b`]).get();
  assert.equal(logs.size, 2, 'обе записи пакета сохранены');
  const saved = logs.docs.map(d => d.data()).find(r => r.request_id === `${runId}-a`);
  assert.equal(typeof saved.payload.object.keyboard.buttons[0], 'string');
  assert.ok(saved.expireAt, 'есть expireAt для TTL');

  // 2. Счётчики статистики (processed_event → vk_event_types.like_add).
  await new Promise(r => setTimeout(r, 300));
  const overview = await getOverview24h();
  const top = await getTopVkEventTypes(10);
  assert.ok(overview.vk_events_24h >= 1);
  assert.ok(top.some(t => t.vk_event_type === 'like_add' && t.events >= 1));

  // 3. Дедуп переживает «рестарт»: ключ, записанный в Firestore, находится другим контекстом.
  const ctx = { type: 'group_join', event_id: `${runId}-ev`, group_id: 1, object: { user_id: 1 } };
  assert.equal(await shouldProcessEvent(ctx, db), true);
  rememberEvent(ctx, db);
  await new Promise(r => setTimeout(r, 300));
  const { dedupKeys } = require('../../src/vk/dedup');
  const snap = await db.collection('dedup_seen').doc(dedupKeys(ctx).primary).get();
  assert.ok(snap.exists);

  // 4. Состояние: сохранение и загрузка, неизвестные ключи игнорируются.
  const state = { CURRENT_MAIN_CHAT_ID: '-100', eventToggleState: { like_add: false }, topics: { main: null, debug: 5 } };
  await saveState(state);
  await db.collection('bot_state').doc('main').set({ event_toggle_state: { typing_status: true } }, { merge: true });
  const loaded = { CURRENT_MAIN_CHAT_ID: '0', eventToggleState: { like_add: true }, topics: { main: null, debug: null } };
  await loadState(loaded);
  assert.equal(loaded.CURRENT_MAIN_CHAT_ID, '-100');
  assert.equal(loaded.eventToggleState.like_add, false);
  assert.equal('typing_status' in loaded.eventToggleState, false);
  assert.equal(loaded.topics.debug, 5);

  // 5. Запрос /raw_event (orderBy по одному полю — без составного индекса).
  const recent = await db.collection('bot_logs').orderBy('ts', 'desc').limit(50).get();
  assert.ok(recent.size >= 2);
  logger.stopTimer();
});
