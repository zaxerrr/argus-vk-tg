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

function shouldProcessEvent(ctx) {
  const key = buildKey(ctx);
  return !cache.has(key);
}

function rememberEvent(ctx) {
  const key = buildKey(ctx);
  cache.set(key, true);
}

module.exports = { buildKey, shouldProcessEvent, rememberEvent };
