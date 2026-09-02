// src/lib/stateStore.js — персистентность рантайм-настроек (тумблеры событий, основной чат) в Supabase.
// Без этого eventToggleState/CURRENT_MAIN_CHAT_ID сбрасывались бы к дефолтам при каждом рестарте.
const { supabase } = require('./db');
const { logError } = require('./logger');

const ROW_ID = 1;

async function loadState(state) {
  try {
    const { data, error } = await supabase
      .from('bot_state')
      .select('main_chat_id, event_toggle_state, topics')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) {
      logError('state', 'load_failed', error);
      return;
    }
    if (!data) return;

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
    const { error } = await supabase.from('bot_state').upsert({
      id: ROW_ID,
      main_chat_id: String(state.CURRENT_MAIN_CHAT_ID),
      event_toggle_state: state.eventToggleState,
      topics: state.topics,
      updated_at: new Date().toISOString(),
    });
    if (error) logError('state', 'save_failed', error);
  } catch (e) {
    logError('state', 'save_exception', e);
  }
}

module.exports = { loadState, saveState };
