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

const { db, FieldValue } = require('./db');

function todayDocId() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

// Вызывается на каждую запись лога (см. FirestoreLogger.push в logger.js). Не бросает исключений
// наружу — сбой счётчика не должен ронять логирование/обработку события.
function bumpStatsCounters(rec) {
  const updates = {};

  if (rec.source === 'vk' && rec.event === 'incoming_update') {
    updates.vk_events = FieldValue.increment(1);
    const rawType = rec.payload && rec.payload.type;
    // Тип события VK приходит из внешнего вебхука — используется как сегмент пути поля Firestore,
    // поэтому валидируем строго, иначе кладём в "other" (защита от path injection через payload.type).
    const type = typeof rawType === 'string' && /^[a-z0-9_]+$/.test(rawType) ? rawType : 'other';
    // ВАЖНО: вложенный объект, а не строковый ключ "vk_event_types.<type>" — set(..., {merge:true})
    // не разбивает точки в строковых ключах на путь (это делает только update()); строковый ключ
    // с точкой создавал бы отдельное ЛИТЕРАЛЬНОЕ поле с точкой в имени, а не вложенную карту
    // vk_event_types. Из-за этого getTopVkEventTypes() всегда читал пустую карту, хотя vk_events
    // (общий счётчик, отдельное плоское поле) исправно рос.
    updates.vk_event_types = { [type]: FieldValue.increment(1) };
  }
  if (rec.source === 'telegram' && rec.event === 'incoming_update') {
    updates.telegram_updates = FieldValue.increment(1);
  }
  if (rec.source === 'telegram' && rec.event === 'outgoing_message') {
    updates.telegram_sent = FieldValue.increment(1);
  }
  if (rec.level === 'error') {
    updates.errors = FieldValue.increment(1);
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

// Человекочитаемые подписи для типов событий VK в дайджесте — только для отображения, ключ
// счётчика в Firestore (vk_event_types.<type>) остаётся сырым типом VK. Тип без подписи здесь
// просто печатается как есть (см. objNounDative/objNounAblative в src/vk/format.js — похожий
// принцип "явный список + fallback").
const VK_TYPE_LABELS = {
  message_new: 'Сообщения',
  message_reply: 'Ответы на сообщения',
  message_edit: 'Отредактированные сообщения',
  message_allow: 'Разрешения на сообщения',
  message_deny: 'Запреты сообщений',
  message_typing_state: 'Печатает',
  message_event: 'Нажатия кнопок',
  message_reaction_event: 'Реакции на сообщения',
  wall_post_new: 'Посты на стене',
  wall_post_edit: 'Отредактированные посты',
  wall_repost: 'Репосты',
  wall_reply_new: 'Комментарии к постам',
  wall_reply_edit: 'Отредактированные комментарии',
  wall_reply_delete: 'Удалённые комментарии',
  wall_reply_restore: 'Восстановленные комментарии',
  photo_new: 'Новые фото',
  photo_comment_new: 'Комментарии к фото',
  photo_comment_edit: 'Отредактированные комментарии к фото',
  photo_comment_delete: 'Удалённые комментарии к фото',
  photo_comment_restore: 'Восстановленные комментарии к фото',
  video_new: 'Новые видео',
  video_comment_new: 'Комментарии к видео',
  video_comment_edit: 'Отредактированные комментарии к видео',
  video_comment_delete: 'Удалённые комментарии к видео',
  video_comment_restore: 'Восстановленные комментарии к видео',
  audio_new: 'Новое аудио',
  board_post_new: 'Обсуждения: новые посты',
  board_post_edit: 'Обсуждения: правки',
  board_post_delete: 'Обсуждения: удаления',
  market_order_new: 'Новые заказы',
  market_order_edit: 'Изменения заказов',
  market_comment_new: 'Комментарии к товарам',
  market_comment_edit: 'Отредактированные комментарии к товарам',
  market_comment_delete: 'Удалённые комментарии к товарам',
  poll_vote_new: 'Голоса в опросах',
  group_join: 'Вступления в группу',
  group_leave: 'Выходы из группы',
  group_change_photo: 'Смена фото группы',
  group_change_settings: 'Изменения настроек группы',
  group_officers_edit: 'Изменения руководства группы',
  user_block: 'Блокировки пользователей',
  user_unblock: 'Разблокировки пользователей',
  like_add: 'Лайки',
  like_remove: 'Снятые лайки',
  lead_forms_new: 'Лид-формы',
  app_payload: 'Сообщения от приложения',
  vkpay_transaction: 'Платежи VK Pay',
};

function vkTypeLabel(type) {
  return VK_TYPE_LABELS[type] || type;
}

// Показывает только то, что реально произошло — ни одной строки с нулём. Если совсем ничего
// не было за сутки, так и пишет, вместо колонки нулей ("Событий VK: 0", "Ошибок: 0" и т.д.),
// бесполезной для быстрого просмотра.
function formatDigest(overview, topTypes) {
  const lines = ['📊 <b>Статистика за сегодня</b>', ''];

  const summary = [
    overview.vk_events_24h > 0 && `События VK: <b>${overview.vk_events_24h}</b>`,
    overview.telegram_updates_24h > 0 && `Обновления Telegram: <b>${overview.telegram_updates_24h}</b>`,
    overview.telegram_sent_24h > 0 && `Отправлено сообщений: <b>${overview.telegram_sent_24h}</b>`,
    overview.errors_24h > 0 && `Ошибок: <b>${overview.errors_24h}</b>`,
  ].filter(Boolean);

  const hasTopTypes = topTypes && topTypes.length > 0;

  if (summary.length === 0 && !hasTopTypes) {
    lines.push('Событий не было.');
    return lines.join('\n');
  }

  lines.push(...summary);

  if (hasTopTypes) {
    lines.push('', 'По типам событий VK:');
    topTypes.forEach(t => lines.push(`${vkTypeLabel(t.vk_event_type)}: <b>${t.events}</b>`));
  }

  return lines.join('\n');
}

module.exports = { bumpStatsCounters, getOverview24h, getTopVkEventTypes, formatDigest };
