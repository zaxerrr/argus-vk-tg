// src/state.js — состояние бота: тумблеры событий, основной чат, админы

const { TELEGRAM_CHAT_ID, ADMIN_USER_IDS } = require('./config');

const state = {
  CURRENT_MAIN_CHAT_ID: TELEGRAM_CHAT_ID,

  // Максимально полный набор известных типов VK
  eventToggleState: {
    // Сообщения
    message_new: true,
    message_reply: true,
    message_edit: true,
    message_allow: true,
    message_deny: true,
    message_typing_state: false,   // шум ("печатает…"); было "typing_status" — несуществующий тип VK, событие никогда не подавлялось
    message_read: false,           // шум
    message_event: true,           // нажатие callback-кнопки

    // Стена
    wall_post_new: true,
    wall_post_edit: true,
    wall_repost: true,
    wall_reply_new: true,
    wall_reply_edit: true,
    wall_reply_delete: true,
    wall_reply_restore: true,

    // Фото
    photo_new: true,
    photo_comment_new: true,
    photo_comment_edit: true,
    photo_comment_delete: true,
    photo_comment_restore: true,

    // Видео
    video_new: true,
    video_comment_new: true,
    video_comment_edit: true,
    video_comment_delete: true,
    video_comment_restore: true,

    // Аудио
    audio_new: true,

    // Обсуждения
    board_post_new: true,
    board_post_edit: true,
    board_post_delete: true,

    // Маркет
    market_order_new: true,
    market_order_edit: true,
    market_comment_new: true,
    market_comment_edit: true,
    market_comment_delete: true,

    // Опросы
    poll_vote_new: true,

    // Группа/участники
    group_join: true,
    group_leave: true,
    group_change_photo: true,
    group_change_settings: true,
    group_officers_edit: true,
    user_block: true,
    user_unblock: true,

    // Лайки
    like_add: true,
    like_remove: true,

    // Лиды
    lead_forms_new: true,

    // VK Mini Apps / VK Pay
    app_payload: true,
    vkpay_transaction: true
  }
};

function isAdmin(id) {
  return ADMIN_USER_IDS.includes(String(id));
}

// stateStore лениво импортируется, чтобы не тянуть Supabase-клиент туда, где state.js
// используется только для чтения тумблеров (например, из тестов).
function persist() {
  require('./lib/stateStore').saveState(state).catch(() => {});
}

function setMainChat(id) {
  state.CURRENT_MAIN_CHAT_ID = String(id);
  persist();
}

function toggleEvent(type) {
  if (!(type in state.eventToggleState)) return null;
  state.eventToggleState[type] = !state.eventToggleState[type];
  persist();
  return state.eventToggleState[type];
}

async function loadPersistedState() {
  await require('./lib/stateStore').loadState(state);
}

// Возвращает true для всех событий, КРОМЕ явно отключённых (=== false)
function shouldDeliver(type) {
  try {
    const m = state.eventToggleState || {};
    if (Object.prototype.hasOwnProperty.call(m, type) && m[type] === false) return false;
    return true;
  } catch (_) {
    return true;
  }
}

module.exports = {
  state,
  shouldDeliver,
  isAdmin,
  setMainChat,
  toggleEvent,
  loadPersistedState
};
