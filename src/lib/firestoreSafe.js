// src/lib/firestoreSafe.js — приведение произвольного JSON (payload вебхука VK) к виду, который
// примет Firestore. Без побочных эффектов при импорте — тестируется напрямую.
//
// Firestore отклоняет документ целиком, если в нём есть (проверено на эмуляторе):
// - массив прямо внутри массива ("Nested arrays are not allowed") — у VK это, например,
//   keyboard.buttons ([[...]]) в сообщениях сообщества (message_reply/message_edit);
// - undefined ("Cannot use undefined as a Firestore value");
// - поле с зарезервированным именем вида __name__.
// Логгер пишет записи пакетом (batch), и одна такая запись роняла commit всего пакета — до 50
// записей bot_logs (включая processed_event и логи других событий) терялись, оставаясь только в
// консоли Render.

const MAX_DEPTH = 20; // у Firestore лимит вложенности map — 20 уровней

function toFirestoreSafe(value, depth = 0) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return JSON.stringify(value);

  if (Array.isArray(value)) {
    return value.map(item => (Array.isArray(item)
      // Вложенный массив хранится JSON-строкой — данные не теряются, /raw_event их покажет.
      ? JSON.stringify(item)
      : toFirestoreSafe(item, depth + 1)));
  }

  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const safeKey = /^__.*__$/.test(key) ? `_${key}` : key;
    out[safeKey] = toFirestoreSafe(v, depth + 1);
  }
  return out;
}

module.exports = { toFirestoreSafe };
