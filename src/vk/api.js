// src/vk/api.js — единая точка вызова методов VK API.
//
// По текущей документации VK (dev.vk.com/ru/api/api-requests, проверено 2026-09-26):
// - адрес сервера API — api.vk.ru (api.vk.com пока отвечает, но в документации больше не фигурирует);
// - ключ доступа передаётся в заголовке "Authorization: Bearer <ключ>", а не параметром
//   access_token в URL (URL с токеном оседает в логах прокси/HTTP-клиентов);
// - ошибки приходят в теле ответа с HTTP 200: {"error": {"error_code", "error_msg"}}.
// Версия API и домен меняются только здесь.

const axios = require('axios');
const { VK_SERVICE_KEY } = require('../config');

const VK_API_BASE = 'https://api.vk.ru/method';
const VK_API_VERSION = '5.199';

// Возвращает { response } или { error: { error_code, error_msg } } — никогда не бросает:
// сетевые сбои/таймауты заворачиваются в error_code 0, чтобы вызывающий код обрабатывал
// все сбои одинаково.
async function vkApi(method, params = {}, { timeout = 5000 } = {}) {
  try {
    const { data } = await axios.get(`${VK_API_BASE}/${method}`, {
      params: { v: VK_API_VERSION, ...params },
      headers: { Authorization: `Bearer ${VK_SERVICE_KEY}` },
      timeout
    });
    if (data && data.error) return { error: data.error };
    if (data && 'response' in data) return { response: data.response };
    return { error: { error_code: 0, error_msg: 'Пустой/неожиданный ответ VK API' } };
  } catch (e) {
    return { error: { error_code: 0, error_msg: e.message } };
  }
}

function formatVkError(err) {
  if (!err) return '';
  return err.error_code ? `VK API error ${err.error_code}: ${err.error_msg}` : String(err.error_msg);
}

module.exports = { vkApi, formatVkError, VK_API_VERSION, VK_API_BASE };
