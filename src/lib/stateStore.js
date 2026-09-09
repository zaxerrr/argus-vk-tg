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
    if (data.event_toggle_state && typeof data.event_toggle_state === 'object') {
      Object.assign(state.eventToggleState, data.event_toggle_state);
    }
    if (data.topics && typeof data.topics === 'object') {
      Object.assign(state.topics, data.topics);
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
