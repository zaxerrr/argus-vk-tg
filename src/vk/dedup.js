// src/vk/dedup.js — дедупликация
const crypto = require('crypto');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// Короткое окно для контентного ключа, когда у события есть event_id (см. dedupKeys ниже).
const CONTENT_WINDOW_SEC = 60;
const contentCache = new NodeCache({ stdTTL: CONTENT_WINDOW_SEC, checkperiod: 30 });

// Сколько хранить ключ в Firestore (dedup_seen). VK повторяет недоставленное событие через 10 с,
// 3 мин, 10 мин, 30 мин и 1 ч (dev.vk.com, Callback API, заголовок X-Retry-Counter) — сутки с запасом.
const DEDUP_PERSIST_MS = 24 * 60 * 60 * 1000;

const md5 = (v) => crypto.createHash('md5').update(v).digest('hex');

// Контентный ключ — «что за событие» по полям объекта. Нужен как запасной вариант, если у запроса
// нет event_id, и как защита от почти одновременных дублей с разными event_id.
function buildKey({ type, object }) {
  // object_id — первым: у like_add/like_remove есть и post_id (для лайка комментария это ID
  // поста-родителя), и если бы post_id шёл раньше, лайки одного человека на разные комментарии
  // одного поста схлопывались бы. Раньше object_id не было вовсе — все like_add без date
  // хэшировались в один ключ. cmid — номер сообщения у message_reaction_event.
  const objectId =
    object?.object_id || object?.id || object?.comment_id || object?.video_id || object?.photo_id ||
    object?.post_id || object?.message?.id || object?.cmid || object?.item_id ||
    object?.topic_id || object?.poll_id || object?.event_id || object?.message_id || object?.user_id;

  // Актёр события (кто лайкнул/вступил/поставил реакцию/etc) — без него два разных пользователя,
  // сделавших это с одним объектом в одну секунду (или вовсе без date), схлопнулись бы.
  // reacted_id — поле реакции по официальной схеме VK (reactor_id — старое предположение).
  const actorId = object?.liker_id || object?.user_id || object?.from_id || object?.admin_id ||
    object?.reacted_id || object?.reactor_id;

  const payload = {
    type,
    // object_type — чтобы лайк клипа и лайк поста с совпавшим числовым ID не схлопнулись.
    objectType: object?.object_type || null,
    objectId,
    actorId,
    date: object?.date || null
  };
  return md5(JSON.stringify(payload));
}

// event_id — уникальный ID события в каждом запросе Callback API; повторная доставка того же
// события приходит с тем же event_id. Официальная схема VK (VKCOM/vk-api-schema, callback_base):
// "Unique event id. If it passed twice or more - you should ignore it." Поэтому:
// - есть event_id → основной ключ (in-memory 10 мин + Firestore сутки) — event_id; контентный
//   ключ живёт только в памяти CONTENT_WINDOW_SEC. Без этого события без date (вступление, лайк,
//   реакция) после повторения того же действия в течение суток (вступил → вышел → вступил)
//   считались дублем и терялись;
// - нет event_id (старые версии API/тесты) → основной ключ — контентный, как раньше.
function dedupKeys(ctx) {
  const content = buildKey(ctx);
  if (ctx && ctx.event_id) return { primary: md5(`e:${ctx.event_id}`), content };
  return { primary: content, content: null };
}

// db передаётся явно (а не require('../lib/db') внутри модуля), чтобы dedup.js оставался без
// побочных эффектов при простом require() — тесты подставляют лёгкий фейк вместо реального
// Firestore-клиента (см. test/vk/dedup.test.js), не поднимая Firebase Admin SDK.
//
// Зачем Firestore, если есть in-memory кэш: NodeCache сбрасывается при каждом рестарте, а
// бесплатный Render перезапускает процесс часто (сон после 15 мин без входящих запросов, редеплой,
// «Render might restart a Free web service at any time»). Повтор VK после такого рестарта
// in-memory кэш не узнал бы.
//
// Проверка и «захват» ключа в памяти — синхронно, ДО первого await. VK шлёт повторные доставки
// параллельно: если бы ключ помечался только после похода в Firestore, обе доставки проходили бы
// cache.has() и обе уходили бы в Telegram (дубли «к посту (Всего: 92)» ×2 от 26.09.2026).
async function shouldProcessEvent(ctx, db) {
  const { primary, content } = dedupKeys(ctx);
  if (cache.has(primary)) return false;
  if (content && contentCache.has(content)) return false;
  cache.set(primary, true);
  if (content) contentCache.set(content, true);
  if (!db) return true; // без Firestore-клиента (напр. в тестах) — только in-memory уровень

  try {
    const snap = await db.collection('dedup_seen').doc(primary).get();
    return !snap.exists;
  } catch (e) {
    console.warn('[dedup] Проверка в Firestore не удалась, полагаемся только на память:', e.message);
    return true; // недоступность Firestore не должна блокировать обработку реальных событий
  }
}

function rememberEvent(ctx, db) {
  const { primary } = dedupKeys(ctx);
  cache.set(primary, true);
  if (!db) return;
  // Fire-and-forget — не задерживаем обработку события ожиданием записи. expireAt — Date
  // (в Firestore это Timestamp): TTL-политика Firestore работает только с полями этого типа,
  // строковую дату она игнорирует. См. docs/FIREBASE_SETUP.md.
  const now = Date.now();
  db.collection('dedup_seen').doc(primary).set({ ts: new Date(now), expireAt: new Date(now + DEDUP_PERSIST_MS) })
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

module.exports = { buildKey, dedupKeys, shouldProcessEvent, rememberEvent, isMirroredLike };
