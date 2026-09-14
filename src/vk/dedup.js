// src/vk/dedup.js — дедупликация
const crypto = require('crypto');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

function buildKey({ type, object, group_id }) {
  // object_id — реальное поле VK для like_add/like_remove (см. src/vk/events.js, ev.object_id) —
  // раньше отсутствовало здесь, из-за чего все like_add-события (у них нет и object.date) хэшировались
  // в один и тот же ключ и все, кроме первого в TTL-окне, молча считались дубликатами.
  const objectId =
    object?.id || object?.comment_id || object?.video_id || object?.photo_id ||
    object?.post_id || object?.message?.id || object?.user_id || object?.item_id ||
    object?.topic_id || object?.poll_id || object?.object_id || object?.event_id ||
    object?.message_id;

  // Актёр события (кто лайкнул/вступил/поставил реакцию/etc) — без него два разных пользователя,
  // сделавших это с одним и тем же объектом в одну секунду (или вовсе без date), тоже схлопнулись
  // бы в один ключ.
  const actorId = object?.liker_id || object?.user_id || object?.from_id || object?.admin_id ||
    object?.reactor_id;

  const payload = {
    type,
    objectId,
    actorId,
    groupId: group_id || 'nogrp',
    date: object?.date || null
  };
  return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex');
}

// db передаётся явно (а не require('../lib/db') внутри модуля), чтобы dedup.js оставался без
// побочных эффектов при простом require() — тесты подставляют лёгкий фейк вместо реального
// Firestore-клиента (см. test/vk/dedup.test.js), не поднимая Firebase Admin SDK.
//
// Зачем вообще Firestore, если уже есть in-memory кэш: NodeCache живёт только в памяти процесса
// и сбрасывается при каждом рестарте — а на бесплатном тарифе Render процесс перезапускается
// заметно чаще, чем "изредка" (сон после 15 мин простоя, редеплой). Если VK повторно доставляет
// событие (не получив вовремя "ok") уже ПОСЛЕ такого рестарта, in-memory кэш об этом событии
// ничего не знает — и оно обрабатывается повторно, задваивая уведомления. Firestore переживает
// рестарт и закрывает это окно; in-memory кэш остаётся первым, самым дешёвым и быстрым уровнем
// проверки (без похода в сеть) для дублей внутри одного и того же процесса.
async function shouldProcessEvent(ctx, db) {
  const key = buildKey(ctx);
  if (cache.has(key)) return false;
  if (!db) return true; // без Firestore-клиента (напр. в тестах) — только in-memory уровень

  try {
    const snap = await db.collection('dedup_seen').doc(key).get();
    return !snap.exists;
  } catch (e) {
    console.warn('[dedup] Проверка в Firestore не удалась, полагаемся только на память:', e.message);
    return true; // недоступность Firestore не должна блокировать обработку реальных событий
  }
}

function rememberEvent(ctx, db) {
  const key = buildKey(ctx);
  cache.set(key, true);
  if (!db) return;
  // Fire-and-forget — не задерживаем обработку события ожиданием записи.
  db.collection('dedup_seen').doc(key).set({ ts: new Date().toISOString() })
    .catch(e => console.warn('[dedup] Не удалось сохранить ключ в Firestore:', e.message));
}

module.exports = { buildKey, shouldProcessEvent, rememberEvent };
