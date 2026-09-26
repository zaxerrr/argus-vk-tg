// src/vk/dedup.js — дедупликация
const crypto = require('crypto');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// Сколько хранить ключ в Firestore (dedup_seen). Окно повторов VK — минуты, сутки с запасом.
const DEDUP_PERSIST_MS = 24 * 60 * 60 * 1000;

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
    // object_type — чтобы лайк клипа и лайк поста с совпавшим числовым ID не схлопнулись.
    objectType: object?.object_type || null,
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
//
// Проверка и «захват» ключа в памяти — синхронно, ДО первого await. VK шлёт повторные доставки
// параллельно, с интервалом в миллисекунды: если бы ключ помечался только после похода в Firestore
// (как было — в rememberEvent), обе доставки успевали бы пройти cache.has() и обе ушли бы в
// Telegram (дубли «к посту (Всего: 92)» ×2 от 26.09.2026).
async function shouldProcessEvent(ctx, db) {
  const key = buildKey(ctx);
  if (cache.has(key)) return false;
  cache.set(key, true);
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
  // Fire-and-forget — не задерживаем обработку события ожиданием записи. expireAt — Date
  // (в Firestore это Timestamp): TTL-политика Firestore работает только с полями этого типа,
  // строковую дату она игнорирует. См. docs/FIREBASE_SETUP.md.
  const now = Date.now();
  db.collection('dedup_seen').doc(key).set({ ts: new Date(now), expireAt: new Date(now + DEDUP_PERSIST_MS) })
    .catch(e => console.warn('[dedup] Не удалось сохранить ключ в Firestore:', e.message));
}

// Лайк клипа, опубликованного в посте, VK присылает ДВАЖДЫ: like_add на clip и like_add на пост,
// в котором этот клип лежит (лайки у них общие — счётчик поста растёт от каждого лайка клипа).
// ID поста в событии клипа нет, поэтому пару узнаём по «тот же тип события + тот же лайкер +
// тот же владелец, один объект clip, другой post, в пределах MIRROR_WINDOW_SEC» и пропускаем
// второе. Два поста подряд (или два клипа) так не схлопываются — только пара клип↔пост.
const MIRROR_WINDOW_SEC = 10;
const MIRROR_TYPES = new Set(['clip', 'post']);
const mirrorCache = new NodeCache({ stdTTL: MIRROR_WINDOW_SEC, checkperiod: 5 });

function isMirroredLike({ type, object, group_id }) {
  if (type !== 'like_add' && type !== 'like_remove') return false;
  const objType = object?.object_type;
  if (!MIRROR_TYPES.has(objType) || !object?.liker_id) return false;

  const key = [type, group_id || 'nogrp', object.liker_id, object.object_owner_id || object.owner_id || ''].join(':');
  const seenType = mirrorCache.get(key);
  if (seenType && seenType !== objType) {
    mirrorCache.del(key);
    return true;
  }
  mirrorCache.set(key, objType);
  return false;
}

module.exports = { buildKey, shouldProcessEvent, rememberEvent, isMirroredLike };
