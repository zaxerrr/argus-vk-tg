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

// Ошибка Telegram Bot API → { code, retryAfter }. node-telegram-bot-api кладёт ответ API в
// err.response.body ({ ok:false, error_code, description, parameters: { retry_after } }).
function telegramErrorInfo(err) {
  const body = err && err.response && err.response.body;
  return {
    code: body && body.error_code,
    retryAfter: body && body.parameters && body.parameters.retry_after
  };
}

// Сообщить о сбое отправки в роль debug. Раньше сравнивался только chat_id: в схеме «всё в одной
// супергруппе» debug — тема ТОГО ЖЕ чата, что и main, поэтому сбои отправки в main (например,
// "message thread not found") в debug не попадали вообще. Теперь молчим, только если сбой — в
// саму тему debug (иначе рекурсия).
async function reportSendFailure(chatId, threadId, text) {
  const debugTarget = resolveRoleTarget('debug');
  if (!debugTarget.chatId) return;
  const sameChat = String(chatId) === String(debugTarget.chatId);
  const sameThread = (threadId ?? null) === (debugTarget.threadId ?? null);
  if (sameChat && sameThread) return;
  const debugOpts = { disable_web_page_preview: true };
  if (debugTarget.threadId != null) debugOpts.message_thread_id = debugTarget.threadId;
  try { await bot.sendMessage(debugTarget.chatId, `⚠️ ${text}`, debugOpts); } catch {}
}

// Не бросает исключений: возвращает true/false. 400 (неверный HTML, нет темы, слишком длинное
// сообщение) и 403 (бота удалили из чата) не лечатся повтором — раньше такое сообщение
// отправлялось ещё дважды, а в debug уходили три одинаковых предупреждения. На 429 ждём столько,
// сколько просит Telegram (retry_after), но не дольше 30 с.
async function sendTelegramMessageWithRetry(chatId, text, options = {}) {
  const MAX_ATTEMPTS = 3;
  let lastError = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      await bot.sendMessage(chatId, text, { ...options, disable_web_page_preview: true });
      logOutgoing(chatId, text);
      return true;
    } catch (err) {
      lastError = err;
      const { code, retryAfter } = telegramErrorInfo(err);
      console.error(`Ошибка sendMessage (${i + 1}/${MAX_ATTEMPTS}) в чат ${chatId}: ${err.message}`);
      if (code === 400 || code === 403) break;
      if (i < MAX_ATTEMPTS - 1) {
        const waitMs = code === 429 && retryAfter ? Math.min(retryAfter, 30) * 1000 : 1000 * (i + 1);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  await reportSendFailure(chatId, options.message_thread_id,
    `Не удалось отправить сообщение в чат ${chatId}${options.message_thread_id != null ? ` (тема ${options.message_thread_id})` : ''}: ${lastError && lastError.message}`);
  return false;
}

// Отправка по роли уведомлений — не нужно знать конкретный chat/thread, resolveRoleTarget()
// решает это сам (см. выше). Тихо ничего не делает, если роль не сконфигурирована.
async function sendToRole(role, text, options = {}) {
  const { chatId, threadId } = resolveRoleTarget(role);
  if (!chatId || !text) return false;
  const opts = { ...options };
  if (threadId != null) opts.message_thread_id = threadId;
  return sendTelegramMessageWithRetry(String(chatId), text, opts);
}

module.exports = { bot, sendTelegramMessageWithRetry, sendToRole, resolveRoleTarget };
