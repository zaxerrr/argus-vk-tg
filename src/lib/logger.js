
// src/lib/logger.js (CommonJS)
// Структурированный логгер: пишет пакетные записи в Firestore (bot_logs), пакетами через batch()
// (дружелюбно к бесплатным квотам Firestore — меньше сетевых round-trip'ов на запись).
const { db } = require('./db');
const { randomUUID } = require('crypto');

const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 суток — см. expireAt ниже

/** @typedef {'debug'|'info'|'warn'|'error'} Level */
/** @typedef {'in'|'out'|'none'} Direction */

class FirestoreLogger {
  constructor () {
    this.queue = [];
    this.timer = null;
    this.dropping = false;
    this.BATCH_MAX = 50;
    this.FLUSH_MS  = 1000;
    this.QUEUE_HARD_LIMIT = 1000;
  }

  startTimer () {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush().catch(() => {}), this.FLUSH_MS);
  }

  stopTimer () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  push (rec) {
    if (this.queue.length >= this.QUEUE_HARD_LIMIT) {
      this.queue.shift();
      if (!this.dropping) {
        this.dropping = true;
        console.warn('[logger] Переполнение очереди, отбрасываем самые старые записи');
      }
    }
    this.queue.push(rec);
    // Счётчики статистики обновляются сразу и независимо от очереди логов —
    // см. src/lib/stats.js. Ошибка здесь не должна ронять логирование, но раньше эта ошибка
    // проглатывалась молча (пустой catch) — если бы require('./stats') или сам вызов бросали
    // исключение синхронно, /stats показывал бы одни нули без единого следа в логах Render.
    try { require('./stats').bumpStatsCounters(rec); } catch (e) { console.error('[logger] bumpStatsCounters упал:', e.message); }
    if (this.queue.length >= this.BATCH_MAX) {
      // не ждём завершения
      this.flush().catch(() => {});
    }
    this.startTimer();
  }

  async flush () {
    if (this.queue.length === 0) {
      this.stopTimer();
      return;
    }
    const batchRecs = this.queue.splice(0, this.BATCH_MAX);
    try {
      const batch = db.batch();
      for (const r of batchRecs) {
        const ref = db.collection('bot_logs').doc();
        batch.set(ref, {
          ts: r.ts || new Date().toISOString(),
          level: r.level,
          source: r.source || null,
          event: r.event || null,
          request_id: r.request_id || randomUUID(),
          chat_id: r.chat_id || null,
          user_id: r.user_id || null,
          direction: r.direction || 'none',
          summary: r.summary || null,
          payload: r.payload ?? null,
          error: r.error || null,
          // Timestamp для TTL-политики Firestore (ts — строка, TTL её не понимает). Без политики
          // поле ни на что не влияет; с ней bot_logs перестаёт расти бесконечно (там тексты
          // сообщений пользователей). См. docs/FIREBASE_SETUP.md.
          expireAt: new Date(Date.now() + LOG_RETENTION_MS),
        });
      }
      await batch.commit();
    } catch (e) {
      console.error('[logger] Ошибка записи в Firestore:', e && e.message ? e.message : e);
      for (const rec of batchRecs) console.log('[log-fallback]', JSON.stringify(rec));
    }
  }

  write (level, rec) { this.push({ level, ...rec }); }
  debug (rec) { this.write('debug', rec); }
  info  (rec) { this.write('info',  rec); }
  warn  (rec) { this.write('warn',  rec); }
  error (rec) { this.write('error', rec); }
}

const logger = new FirestoreLogger();

// Хелперы для Express
function withRequestId () {
  return (req, _res, next) => {
    req.requestId = req.headers['x-request-id'] || randomUUID();
    next();
  };
}

// Бот работает через long-polling, а не вебхук, поэтому входящие Telegram-сообщения логируются
// из обработчика bot.on('message') в src/telegram.js, а не Express-middleware.
function logIncomingTelegram (msg) {
  logger.info({
    source: 'telegram',
    event: 'incoming_update',
    direction: 'in',
    chat_id: msg?.chat?.id != null ? String(msg.chat.id) : undefined,
    user_id: msg?.from?.id != null ? String(msg.from.id) : undefined,
    summary: msg?.text || 'update',
  });
}

// Входящий вебхук VK. Вызывается из server.js ПОСЛЕ проверки секрета: раньше это был middleware
// перед проверкой, и каждый запрос с неверным секретом (флуд, сканеры) стоил записи в bot_logs —
// квота бесплатного Firestore 20 000 записей/сутки, а rate limiter за прокси Render видел один IP
// на всех. Заодно неаутентифицированные payload больше не попадают в /raw_event.
function logIncomingVK (req) {
  // Поле secret — это VK_SECRET_KEY: не пишем его в bot_logs (оттуда payload читает /raw_event
  // и выводит в Telegram).
  const { secret: _secret, ...body } = req.body || {};
  const obj  = body?.object || {};
  const peer = obj?.peer_id || obj?.message?.peer_id || obj?.chat_id;
  const from = obj?.from_id || obj?.message?.from_id;
  logger.info({
    source: 'vk',
    event: 'incoming_update',
    request_id: req.requestId,
    direction: 'in',
    chat_id: peer ? String(peer) : undefined,
    user_id: from ? String(from) : undefined,
    summary: (obj && obj.message && obj.message.text) || body?.type || 'vk_event',
    payload: body,
  });
}

// Хелперы для исходящих сообщений и ошибок
function logOutgoingMessage (platform, chatId, summary, payload) {
  logger.info({
    source: platform,
    event: 'outgoing_message',
    direction: 'out',
    chat_id: chatId,
    summary,
    payload,
  });
}

function logError (source, event, err, extra = {}) {
  logger.error({
    source,
    event,
    summary: extra.summary || (err && err.message) || 'error',
    error: (err && err.stack) ? String(err.stack) : String(err),
    payload: extra.payload,
    chat_id: extra.chat_id,
    user_id: extra.user_id,
    request_id: extra.request_id,
    direction: extra.direction || 'none',
  });
}

module.exports = {
  logger,
  withRequestId,
  logIncomingTelegram,
  logIncomingVK,
  logOutgoingMessage,
  logError,
};
