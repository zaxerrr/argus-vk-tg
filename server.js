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
const { shouldProcessEvent, rememberEvent, isMirroredLike } = require('./src/vk/dedup');
const { handleVkEvent } = require('./src/vk/events');
const { loadPersistedState } = require('./src/state');
const { createRateLimiter } = require('./src/security/rateLimit');
const { getOverview24h, getTopVkEventTypes, formatDigest } = require('./src/lib/stats');
const { checkVkServiceKey, escapeHtml } = require('./src/utils');

// Логгер Firestore
const { withRequestId, logIncomingVK, logger, logError } = require('./src/lib/logger');
const { db } = require('./src/lib/db');

// Страховка: Node с v15 завершает процесс на необработанном отклонении промиса. Бот — один
// процесс на Render free, и падение из-за единичного сбоя (сеть, Telegram 400 в каком-то
// обработчике) означало бы тишину до следующего пробуждения. Логируем и живём дальше.
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
  try { logError('process', 'unhandled_rejection', reason); } catch (_) {}
});

const app = express();
app.disable('x-powered-by');

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

// Проверка состояния. Render сам дёргает healthCheckPath «каждые несколько секунд» (render.com/docs/
// health-checks) — раньше каждый вызов стоил чтения Firestore, т.е. тысячи чтений в сутки из
// бесплатных 50 000 только на health checks. Результат пинга Firestore кэшируется на минуту.
// Всегда 200: при 4xx/5xx дольше 60 с Render перезапускает инстанс, а недоступный Firestore —
// не повод перезапускать бота (события и команды без него работают).
const FIRESTORE_PING_TTL_MS = 60_000;
let firestorePing = { ok: false, at: 0 };

app.get('/health', async (req, res) => {
  const up = Math.floor((Date.now() - (global.__BOT_STARTED_AT?.getTime() || Date.now())) / 1000);

  if (Date.now() - firestorePing.at > FIRESTORE_PING_TTL_MS) {
    let ok = false;
    try {
      const ping = db.collection('bot_logs').limit(1).get();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([ping, timeout]);
      ok = true;
    } catch (_) {
      ok = false;
    }
    firestorePing = { ok, at: Date.now() };
  }

  res.status(200).json({ ok: true, uptime_sec: up, ts: new Date().toISOString(), firestore: firestorePing.ok });
});

// Вебхук VK
//
// Rate limit применяется только к запросам с НЕВЕРНЫМ секретом. За прокси Render (Cloudflare +
// балансировщик) req.ip без trust proxy — адрес прокси, один на всех: общий лимит 120/мин мог
// бы выбрать флудер, и тогда VK получал бы 429 на настоящие события. А по документации VK
// (dev.vk.com, Callback API): «если сервер несколько раз подряд вернёт ошибку, Callback API
// временно перестанет отправлять на него уведомления». Аутентифицированный VK не ограничиваем.
const badSecretRateLimit = createRateLimiter({ windowMs: 60_000, max: 120 });

// Одно предупреждение в debug-роль за запуск, если события приходят от чужого сообщества.
let foreignGroupWarned = false;
const EXPECTED_GROUP_ID = Math.abs(Number(VK_GROUP_ID));

app.post('/webhook', async (req, res) => {
  const { type, object, group_id, secret, event_id } = req.body || {};
  // X-Retry-Counter — число неудачных попыток доставки этого события (VK повторяет через 10 с,
  // 3 мин, 10 мин, 30 мин, 1 ч). Повтор на Render free почти всегда значит «инстанс спал».
  const retry = req.get('X-Retry-Counter');
  // Логируем сам факт запроса ДО проверки секрета — иначе отказ по секрету не оставляет в логах
  // ни следа, и "пустые логи" неотличимы от "VK вообще не стучится на вебхук".
  console.log(`[${new Date().toISOString()}] VK запрос: type=${type || '?'} group_id=${group_id || '?'}${retry ? ` retry=${retry}` : ''}`);

  // Проверка секрета (timing-safe, чтобы не давать утечку через разницу во времени сравнения)
  const provided = Buffer.from(String(secret || ''));
  const expected = Buffer.from(String(VK_SECRET_KEY));
  const secretOk = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!secretOk) {
    console.warn(`[${new Date().toISOString()}] VK secret не совпал — запрос отклонён (403)`);
    return badSecretRateLimit(req, res, () => res.status(403).send('Forbidden'));
  }

  logIncomingVK(req);

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

  // Событие другого сообщества (тот же URL и секрет подключены ещё к одной группе, или
  // VK_GROUP_ID не обновлён после переключения на новую группу). Отвечаем "ok" — иначе VK будет
  // повторять и в итоге приостановит отправку, — но не пересылаем: ссылки строятся от VK_GROUP_ID.
  if (Number.isFinite(EXPECTED_GROUP_ID) && Number(group_id) !== EXPECTED_GROUP_ID) {
    console.warn(`[${new Date().toISOString()}] VK событие от group_id=${group_id}, ожидается ${EXPECTED_GROUP_ID} — пропуск`);
    logger.warn({ source: 'vk', event: 'foreign_group', request_id: req.requestId, summary: `group_id=${group_id}`, payload: { type } });
    if (!foreignGroupWarned) {
      foreignGroupWarned = true;
      sendToRole('debug', `⚠️ Пришло событие VK от сообщества ${escapeHtml(group_id)}, а VK_GROUP_ID=${EXPECTED_GROUP_ID}. Такие события пропускаются — проверьте VK_GROUP_ID в Render.`).catch(() => {});
    }
    return res.send('ok');
  }

  // Быстрое подтверждение, чтобы VK не ретраил
  res.send('ok');

  try {
    // Дедуп — сначала дешёвая проверка в памяти, затем (если её недостаточно) в Firestore,
    // переживающем рестарт процесса. См. комментарий в src/vk/dedup.js.
    const ctx = { type, object, group_id, event_id };
    if (!(await shouldProcessEvent(ctx, db))) {
      console.log('Дубликат — пропуск.');
      return;
    }
    rememberEvent(ctx, db);
    if (isMirroredLike({ type, object, group_id })) {
      console.log('Зеркальный лайк клип↔пост — пропуск.');
      return;
    }
    logger.info({ source: 'vk', event: 'processed_event', request_id: req.requestId, summary: type, payload: { type } });

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

    // Проверка VK_SERVICE_KEY при старте — без этого невалидный/просроченный ключ был виден
    // только косвенно, через молча пропадающие счётчики лайков (см. src/utils.js).
    // Проверяется сам likes.getList — см. checkVkServiceKey в src/utils.js.
    const vkKeyCheck = await checkVkServiceKey(VK_GROUP_ID).catch(e => ({ ok: false, likesOk: false, error: e.message }));
    if (!vkKeyCheck.ok) {
      lines.push(`VK_SERVICE_KEY: ❌ ${escapeHtml(vkKeyCheck.error)}`);
    } else if (vkKeyCheck.likesOk === true) {
      lines.push('VK_SERVICE_KEY: ✅ OK, счётчики лайков работают');
    } else if (vkKeyCheck.likesOk === false) {
      lines.push(`VK_SERVICE_KEY: ⚠️ ключ валиден, но счётчиков лайков не будет — ${escapeHtml(vkKeyCheck.error)}`);
    } else {
      lines.push(`VK_SERVICE_KEY: ✅ ключ валиден (likes.getList не проверен: ${escapeHtml(vkKeyCheck.error)})`);
    }
    if (vkKeyCheck.likesOk !== true) console.warn('[boot] Проверка VK_SERVICE_KEY:', vkKeyCheck.error);

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
