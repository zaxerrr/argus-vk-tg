// src/utils.js — утилиты

const NodeCache = require('node-cache');
const { vkApi, formatVkError } = require('./vk/api');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Имена кэшируются на час: одно и то же имя часто нужно несколько раз подряд (лайк + снятие лайка,
// пара клип↔пост, серия комментариев), а у VK API ограничение на частоту запросов (ошибка 6) —
// при всплеске событий без кэша имена деградировали бы до "ID 123".
const nameCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Возвращает сырой текст — экранирует вызывающий (userLink в src/vk/events.js), иначе имена
// с &/</" экранировались бы дважды. Отрицательный ID — сообщество (VK присылает такие, например,
// в from_id комментария, оставленного от имени сообщества, или в from_id исходящего сообщения).
async function getVkUserName(ownerId) {
  const id = Number(ownerId);
  if (!Number.isFinite(id) || id === 0) return `ID ${ownerId}`;
  const cached = nameCache.get(id);
  if (cached) return cached;

  let name = null;
  if (id < 0) {
    const { response, error } = await vkApi('groups.getById', { group_id: -id });
    // С версии 5.139 ответ — { groups: [...] }, раньше был массив.
    const g = response && (Array.isArray(response) ? response[0] : response.groups && response.groups[0]);
    if (g && g.name) name = g.name;
    else if (error) console.warn(`[vk] groups.getById(${-id}): ${formatVkError(error)}`);
  } else {
    const { response, error } = await vkApi('users.get', { user_ids: id, lang: 'ru' });
    const u = response && response[0];
    if (u) name = u.deactivated ? `[Деактивирован] ID ${id}` : `${u.first_name} ${u.last_name}`;
    else if (error) console.warn(`[vk] users.get(${id}): ${formatVkError(error)}`);
  }

  if (!name) return id < 0 ? `Сообщество ${-id}` : `ID ${id}`; // не кэшируем сбой
  nameCache.set(id, name);
  return name;
}

// Ссылка на профиль/сообщество VK по ID владельца (отрицательный — сообщество).
function vkOwnerUrl(ownerId) {
  const id = Number(ownerId);
  return id < 0 ? `https://vk.com/club${-id}` : `https://vk.com/id${id}`;
}

// Проверка VK_SERVICE_KEY при старте. Раньше проверялся только groups.getById — он проходит с
// ключом ЛЮБОГО типа, включая ключ сообщества, с которым likes.getList всегда падает (ошибка 27),
// поэтому "✅ OK" в стартовом сообщении не гарантировал счётчики лайков. Теперь проверяется ровно
// тот вызов, ради которого ключ нужен: likes.getList на последнем посте сообщества.
// Возвращает { ok, likesOk, error }: ok — ключ вообще валиден; likesOk — счётчики будут работать
// (null — проверить не на чем: на стене нет постов).
async function checkVkServiceKey(groupId) {
  const g = await vkApi('groups.getById', { group_id: groupId });
  if (g.error) return { ok: false, likesOk: false, error: formatVkError(g.error) };

  const w = await vkApi('wall.get', { owner_id: -Number(groupId), count: 1 });
  const post = w.response && w.response.items && w.response.items[0];
  if (!post) return { ok: true, likesOk: null, error: w.error ? formatVkError(w.error) : 'на стене нет постов' };

  const l = await vkApi('likes.getList', { type: 'post', owner_id: -Number(groupId), item_id: post.id, count: 1 });
  if (l.error) {
    const hint = l.error.error_code === 27
      ? ' — это ключ сообщества; для счётчиков нужен сервисный ключ приложения или пользовательский токен (docs/VK_API.md)'
      : '';
    return { ok: true, likesOk: false, error: formatVkError(l.error) + hint };
  }
  return { ok: true, likesOk: true };
}

module.exports = { escapeHtml, getVkUserName, vkOwnerUrl, checkVkServiceKey };
