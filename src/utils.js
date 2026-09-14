// src/utils.js — утилиты

const axios = require('axios');
const { VK_SERVICE_KEY } = require('./config');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function getVkUserName(userId) {
  try {
    const resp = await axios.get('https://api.vk.com/method/users.get', {
      params: { user_ids: userId, access_token: VK_SERVICE_KEY, v: '5.199', lang: 'ru' }
    });
    const u = resp.data?.response?.[0];
    if (!u) return `ID ${userId}`;
    if (u.deactivated) return `[Деактивирован] ID ${userId}`;
    return `${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)}`;
  } catch (e) {
    console.error('VK users.get error:', e.message);
    return `ID ${userId}`;
  }
}

// Лёгкая проверка VK_SERVICE_KEY при старте — без неё невалидный/просроченный ключ обнаруживался
// бы только косвенно, через пропавшие счётчики лайков (tryGetLikesCount в src/vk/events.js молча
// возвращает null при любой ошибке VK API), спустя дни молчания. groups.getById — самый дешёвый
// метод, не требующий прав сверх стандартного ключа доступа сообщества.
async function checkVkServiceKey(groupId) {
  try {
    const resp = await axios.get('https://api.vk.com/method/groups.getById', {
      params: { group_id: groupId, access_token: VK_SERVICE_KEY, v: '5.199' },
      timeout: 5000
    });
    if (resp.data && resp.data.error) {
      return { ok: false, error: `VK API error ${resp.data.error.error_code}: ${resp.data.error.error_msg}` };
    }
    if (resp.data && resp.data.response) {
      return { ok: true };
    }
    return { ok: false, error: 'Пустой/неожиданный ответ VK API' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { escapeHtml, getVkUserName, checkVkServiceKey };
