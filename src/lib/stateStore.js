// src/lib/stateStore.js — персистентность рантайм-настроек (тумблеры событий, основной чат, темы)
// в Firestore, документ bot_state/main. Без этого state сбрасывался бы к дефолтам при рестарте.
const { db } = require('./db');
const { logError } = require('./logger');

function stateDocRef() {
  return db.collection('bot_state').doc('main');
}

async function loadState(state) {
  try {
    const snap = await stateDocRef().get();
    if (!snap.exists) return;
    const data = snap.data();

    if (data.main_chat_id) state.CURRENT_MAIN_CHAT_ID = String(data.main_chat_id);
    // Только известные коду ключи: иначе в /list_events навсегда оставались бы типы, давно
    // удалённые из src/state.js (например, старый несуществующий "typing_status").
    if (data.event_toggle_state && typeof data.event_toggle_state === 'object') {
      for (const [key, value] of Object.entries(data.event_toggle_state)) {
        if (key in state.eventToggleState && typeof value === 'boolean') state.eventToggleState[key] = value;
      }
    }
    if (data.topics && typeof data.topics === 'object') {
      for (const [role, value] of Object.entries(data.topics)) {
        if (role in state.topics && (value === null || Number.isFinite(value))) state.topics[role] = value;
      }
    }
  } catch (e) {
    logError('state', 'load_exception', e);
  }
}

async function saveState(state) {
  try {
    await stateDocRef().set({
      main_chat_id: String(state.CURRENT_MAIN_CHAT_ID),
      event_toggle_state: state.eventToggleState,
      topics: state.topics,
      updated_at: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    logError('state', 'save_exception', e);
  }
}

module.exports = { loadState, saveState };
