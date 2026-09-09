// src/lib/stats.js — статистика в реальном времени на Firestore.
//
// В отличие от старой SQL-вьюх-версии (Supabase), это не скользящее окно "последние 24 часа",
// а счётчики за текущие календарные сутки (UTC), инкрементируемые атомарно на каждое событие —
// bumpStatsCounters() вызывается из src/lib/logger.js при каждой записи в лог. /stats и
// автодайджест (STATS_DIGEST_HOURS) читают один документ (1 read) вместо агрегирующего запроса —
// экономит бесплатные квоты Firestore (Spark-план: 50k чтений / 20k записей в день).
//
// Компромисс: счётчики обнуляются в полночь UTC, а не "24 часа назад от сейчас"; топ типов
// событий VK — тоже только за сегодня, без истории по дням (SQL-вьюхи это умели, здесь — нет).

const { db, admin } = require('./db');

function todayDocId() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

// Вызывается на каждую запись лога (см. FirestoreLogger.push в logger.js). Не бросает исключений
// наружу — сбой счётчика не должен ронять логирование/обработку события.
function bumpStatsCounters(rec) {
  const updates = {};

  if (rec.source === 'vk' && rec.event === 'incoming_update') {
    updates.vk_events = admin.firestore.FieldValue.increment(1);
    const rawType = rec.payload && rec.payload.type;
    // Тип события VK приходит из внешнего вебхука — используется как сегмент пути поля Firestore,
    // поэтому валидируем строго, иначе кладём в "other" (защита от path injection через payload.type).
    const type = typeof rawType === 'string' && /^[a-z0-9_]+$/.test(rawType) ? rawType : 'other';
    updates[`vk_event_types.${type}`] = admin.firestore.FieldValue.increment(1);
  }
  if (rec.source === 'telegram' && rec.event === 'incoming_update') {
    updates.telegram_updates = admin.firestore.FieldValue.increment(1);
  }
  if (rec.source === 'telegram' && rec.event === 'outgoing_message') {
    updates.telegram_sent = admin.firestore.FieldValue.increment(1);
  }
  if (rec.level === 'error') {
    updates.errors = admin.firestore.FieldValue.increment(1);
  }
  if (Object.keys(updates).length === 0) return;

  db.collection('stats_daily').doc(todayDocId()).set(updates, { merge: true })
    .catch(e => console.error('[stats] Не удалось обновить счётчики:', e.message));
}

async function getOverview24h() {
  const snap = await db.collection('stats_daily').doc(todayDocId()).get();
  const data = snap.exists ? snap.data() : {};
  return {
    vk_events_24h: data.vk_events || 0,
    telegram_updates_24h: data.telegram_updates || 0,
    telegram_sent_24h: data.telegram_sent || 0,
    errors_24h: data.errors || 0,
  };
}

async function getTopVkEventTypes(limit = 10) {
  const snap = await db.collection('stats_daily').doc(todayDocId()).get();
  const types = (snap.exists && snap.data().vk_event_types) || {};
  return Object.entries(types)
    .map(([vk_event_type, events]) => ({ vk_event_type, events }))
    .sort((a, b) => b.events - a.events)
    .slice(0, limit);
}

function formatDigest(overview, topTypes) {
  const lines = [
    '📊 <b>Статистика за сегодня</b>',
    '',
    `События VK: <b>${overview.vk_events_24h}</b>`,
    `Обновления Telegram: <b>${overview.telegram_updates_24h}</b>`,
    `Отправлено сообщений: <b>${overview.telegram_sent_24h}</b>`,
    `Ошибок: <b>${overview.errors_24h}</b>`
  ];
  if (topTypes && topTypes.length) {
    lines.push('', 'Топ типов событий VK:');
    topTypes.forEach((t, i) => lines.push(`${i + 1}. ${t.vk_event_type} — ${t.events}`));
  }
  return lines.join('\n');
}

module.exports = { bumpStatsCounters, getOverview24h, getTopVkEventTypes, formatDigest };
