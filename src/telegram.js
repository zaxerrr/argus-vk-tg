// src/telegram.js — инициализация бота, отправка сообщений и маршрутизация по "ролям"
// уведомлений (main/lead/debug/stats) с поддержкой тем (message_thread_id) форум-супергруппы.

const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_BOT_TOKEN, LEAD_CHAT_ID, DEBUG_CHAT_ID, STATS_CHAT_ID } = require('./config');
const { state } = require('./state');
// Ленивый require — logger.js тянет src/lib/db.js (Firebase Admin SDK), а telegram.js
// используется и в местах, где это нежелательно на этапе require (см. CLAUDE.md, тестирование).
function logOutgoing (chatId, text) {
  try { require('./lib/logger').logOutgoingMessage('telegram', String(chatId), text); } catch (_) {}
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.on('message', msg => {
  try { require('./lib/logger').logIncomingTelegram(msg); } catch (_) {}
});

// 409 Conflict — этот токен одновременно опрашивает ещё один процесс. На Render это ожидаемо
// после каждого деплоя: старый инстанс получает SIGTERM только через 60 с после того, как новый
// стал healthy (render.com/docs/deploys, zero-downtime deploys), и всё это время оба делают
// getUpdates. Без обработчика библиотека печатала стек на каждую попытку. Если 409 держится
// дольше пары минут — тот же токен запущен где-то ещё (локально, второй сервис).
let lastConflictLogAt = 0;
bot.on('polling_error', err => {
  const code = err && err.response && err.response.body && err.response.body.error_code;
  if (code === 409) {
    if (Date.now() - lastConflictLogAt > 60_000) {
      lastConflictLogAt = Date.now();
      console.warn('[telegram] 409 Conflict: этот токен опрашивает ещё один экземпляр бота. Норма на 1–2 мин после деплоя на Render; дольше — ищите второй запуск с тем же TELEGRAM_BOT_TOKEN.');
    }
    return;
  }
  console.error('[telegram] polling_error:', err && err.code, err && err.message);
});

// Отдельный чат на роль (старый способ — несколько чатов). "main" всегда — основной чат.
const ROLE_CHAT_ENV = { lead: LEAD_CHAT_ID, debug: DEBUG_CHAT_ID, stats: STATS_CHAT_ID };

// Решает, куда слать сообщение данной роли:
// 1. main — всегда основной чат (state.CURRENT_MAIN_CHAT_ID), плюс тема main, если задана.
// 2. Роль с отдельным *_CHAT_ID — шлём в этот чат (как раньше), тема (если задана) — внутри него.
// 3. Роль без отдельного чата, но с заданной темой — значит роль живёт в теме ОСНОВНОГО чата
//    (сценарий "всё в одной супергруппе"): шлём в state.CURRENT_MAIN_CHAT_ID с этой темой.
// 4. Ни чат, ни тема не заданы — роль отключена (chatId=null), как и раньше при пустом *_CHAT_ID.
function resolveRoleTarget(role) {
  const topicId = state.topics && state.topics[role] != null ? state.topics[role] : undefined;
  if (role === 'main') {
    return { chatId: state.CURRENT_MAIN_CHAT_ID, threadId: topicId };
  }
  const explicitChat = ROLE_CHAT_ENV[role];
  if (explicitChat) return { chatId: explicitChat, threadId: topicId };
  if (topicId != null) return { chatId: state.CURRENT_MAIN_CHAT_ID, threadId: topicId };
  return { chatId: null, threadId: undefined };
}

async function sendTelegramMessageWithRetry(chatId, text, options = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      await bot.sendMessage(chatId, text, { ...options, disable_web_page_preview: true });
      logOutgoing(chatId, text);
      return;
    } catch (err) {
      const msg = `Ошибка sendMessage (${i + 1}/3) в чат ${chatId}: ${err.message}`;
      console.error(msg);
      const debugTarget = resolveRoleTarget('debug');
      if (debugTarget.chatId && String(chatId) !== String(debugTarget.chatId)) {
        const debugOpts = { disable_web_page_preview: true };
        if (debugTarget.threadId != null) debugOpts.message_thread_id = debugTarget.threadId;
        try { await bot.sendMessage(debugTarget.chatId, `⚠️ ${msg}`, debugOpts); } catch {}
      }
      if (i < 2) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Отправка по роли уведомлений — не нужно знать конкретный chat/thread, resolveRoleTarget()
// решает это сам (см. выше). Тихо ничего не делает, если роль не сконфигурирована.
async function sendToRole(role, text, options = {}) {
  const { chatId, threadId } = resolveRoleTarget(role);
  if (!chatId || !text) return;
  const opts = { ...options };
  if (threadId != null) opts.message_thread_id = threadId;
  await sendTelegramMessageWithRetry(String(chatId), text, opts);
}

module.exports = { bot, sendTelegramMessageWithRetry, sendToRole, resolveRoleTarget };
