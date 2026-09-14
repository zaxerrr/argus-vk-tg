// server.js — HTTP-склейка и маршруты

const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');

const {
  VK_GROUP_ID,
  VK_SECRET_KEY,
  VK_CONFIRMATION_CODE,
  TELEGRAM_CHAT_ID,
  BOT_VERSION,
  STATS_DIGEST_HOURS
} = require('./src/config');

const { bot, sendToRole } = require('./src/telegram');
const { registerCommands } = require('./src/commands');
const { shouldProcessEvent, rememberEvent } = require('./src/vk/dedup');
const { handleVkEvent } = require('./src/vk/events');
const { loadPersistedState } = require('./src/state');
const { createRateLimiter } = require('./src/security/rateLimit');
const { getOverview24h, getTopVkEventTypes, formatDigest } = require('./src/lib/stats');

// Логгер Firestore
const { withRequestId, logMiddlewareVK, logger, logError } = require('./src/lib/logger');
const { db } = require('./src/lib/db');

const app = express();

app.use(withRequestId());
app.use(bodyParser.json({ limit: '1mb' }));

// глобальный аптайм
global.__BOT_STARTED_AT = new Date();

// Регистрация команд
registerCommands(bot);

// Периодический дайджест статистики (опционально) — см. src/lib/stats.js и роль "stats"
// в src/telegram.js. Без STATS_DIGEST_HOURS автодайджест выключен, доступна только /stats.
if (STATS_DIGEST_HOURS) {
  const intervalMs = STATS_DIGEST_HOURS * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const [overview, top] = await Promise.all([getOverview24h(), getTopVkEventTypes(10)]);
      await sendToRole('stats', formatDigest(overview, top), { parse_mode: 'HTML' });
    } catch (e) {
      logError('stats', 'digest_failed', e);
    }
  }, intervalMs).unref();
}

// Проверка состояния
app.get('/health', async (req, res) => {
  const up = Math.floor((Date.now() - (global.__BOT_STARTED_AT?.getTime() || Date.now())) / 1000);

  let firestoreOk = false;
  try {
    const ping = db.collection('bot_logs').limit(1).get();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
    await Promise.race([ping, timeout]);
    firestoreOk = true;
  } catch (_) {
    firestoreOk = false;
  }

  res.status(200).json({ ok: true, uptime_sec: up, ts: new Date().toISOString(), firestore: firestoreOk });
});

// Вебхук VK
const webhookRateLimit = createRateLimiter({ windowMs: 60_000, max: 120 });

app.post('/webhook', webhookRateLimit, logMiddlewareVK(), async (req, res) => {
  const { type, object, group_id, secret } = req.body || {};
  // Логируем сам факт запроса ДО проверки секрета — иначе отказ по секрету (опечатка/смена
  // VK_SECRET_KEY при переключении на другую группу) не оставляет в логах ни следа, и "пустые
  // логи" неотличимы от "VK вообще не стучится на вебхук".
  console.log(`[${new Date().toISOString()}] VK запрос: type=${type || '?'} group_id=${group_id || '?'}`);

  // Проверка секрета (timing-safe, чтобы не давать утечку через разницу во времени сравнения)
  const provided = Buffer.from(String(secret || ''));
  const expected = Buffer.from(String(VK_SECRET_KEY));
  const secretOk = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!secretOk) {
    console.warn(`[${new Date().toISOString()}] VK secret не совпал — запрос отклонён (403)`);
    return res.status(403).send('Forbidden');
  }

  // Подтверждение сервера VK: нужно вернуть РОВНО строку из настроек Callback API
  // (не "ok") — иначе VK не активирует Callback API для нового сообщества.
  if (type === 'confirmation') {
    if (!VK_CONFIRMATION_CODE) {
      console.warn('VK_CONFIRMATION_CODE не задан — подтверждение Callback API, скорее всего, не пройдёт.');
    }
    return res.send(VK_CONFIRMATION_CODE || 'ok');
  }

  // Шумные события — просто подтверждаем без обработки
  if (type === 'message_typing_state' || type === 'message_read') {
    return res.send('ok');
  }

  // Быстрое подтверждение, чтобы VK не ретраил
  res.send('ok');

  try {
    // Дедуп — сначала дешёвая проверка в памяти, затем (если её недостаточно) в Firestore,
    // переживающем рестарт процесса. См. комментарий в src/vk/dedup.js.
    if (!(await shouldProcessEvent({ type, object, group_id }, db))) {
      console.log('Дубликат — пропуск.');
      return;
    }
    rememberEvent({ type, object, group_id }, db);

    // Обработка события
    await handleVkEvent({ type, object });

  } catch (e) {
    console.error('Ошибка обработки VK-события:', e.message);
    logError('vk', 'handle_event_failed', e, { request_id: req.requestId, payload: { type } });
    await sendToRole('debug', `❌ Ошибка: ${e.message}`);
  }
});

// Единый обработчик ошибок Express (напр. невалидный JSON от body-parser) —
// без него ошибка ушла бы в дефолтный обработчик Express со стектрейсом в ответе.
app.use((err, req, res, _next) => {
  console.error('Необработанная ошибка Express:', err.message);
  logError('http', 'express_error', err, { request_id: req.requestId });
  if (res.headersSent) return;
  res.status(400).json({ ok: false, error: 'Bad Request' });
});

// Запуск
const PORT = process.env.PORT || 3000;

let server;

(async () => {
  await loadPersistedState();

  server = app.listen(PORT, async () => {
    logger.info({ source: 'system', event: 'boot', summary: `Bot v${BOT_VERSION} started`, payload: { port: PORT } });
    console.log(`[${new Date().toISOString()}] Сервер на порту ${PORT}`);
    // стартовое сообщение в роль "debug" (не отправляется, если роль не сконфигурирована)
    const communityUrl = `https://vk.com/public${VK_GROUP_ID}`;
    const mainChatId = String(TELEGRAM_CHAT_ID);
    const mainChatPublicId = mainChatId.startsWith('-100') ? mainChatId.slice(4) : mainChatId.replace('-', '');
    const mainChatUrl = `https://t.me/c/${mainChatPublicId}`;
    const lines = [
      '🟢 Система запущена!',
      `Сообщество: <a href="${communityUrl}">${communityUrl}</a>`,
      `Версия: ${BOT_VERSION}`,
      `Время (МСК): ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
      `Основной чат: <a href="${mainChatUrl}">${mainChatUrl}</a>`
    ];
    await sendToRole('debug', lines.join('\n'), { parse_mode: 'HTML', disable_web_page_preview: true });
  });
})();

// Graceful shutdown — останавливаем polling и дожимаем очередь логов перед выходом,
// чтобы не терять последние записи при передеплое/рестарте.
async function shutdown(signal) {
  console.log(`[${new Date().toISOString()}] Получен ${signal}, завершение работы...`);
  try { await bot.stopPolling(); } catch (_) {}
  try { await logger.flush(); } catch (_) {}
  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
