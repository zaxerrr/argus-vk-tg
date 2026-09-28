// src/config.js — переменные окружения и валидация

const fs = require('fs');
const path = require('path');

const required = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`ENV ${name} отсутствует`);
    process.exit(1);
  }
  return v;
};

const readPackageVersion = () => {
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const raw = fs.readFileSync(packagePath, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data.version === 'string' ? data.version : null;
  } catch (err) {
    console.warn('Не удалось прочитать версию из package.json:', err.message);
    return null;
  }
};

// Необязательные числовые переменные: мусор в значении раньше молча превращался в NaN —
// STATS_DIGEST_HOURS=abc давал setInterval(NaN), то есть дайджест КАЖДУЮ МИЛЛИСЕКУНДУ (флуд в
// Telegram и чтения Firestore), а TELEGRAM_TOPIC_*_ID=abc — message_thread_id NaN и падающие
// отправки. Теперь невалидное значение игнорируется с предупреждением в логе.
const optionalPositiveNumber = (name) => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`ENV ${name}="${raw}" — не положительное число, значение проигнорировано`);
    return null;
  }
  return n;
};

// ID сообщества VK — без минуса. Значение с минусом (как owner_id в VK) раньше ломало ссылки и
// owner_id по умолчанию (-Number(VK_GROUP_ID) становился положительным).
const RAW_VK_GROUP_ID    = required('VK_GROUP_ID').trim();
const VK_GROUP_ID        = /^-\d+$/.test(RAW_VK_GROUP_ID) ? RAW_VK_GROUP_ID.slice(1) : RAW_VK_GROUP_ID;
if (VK_GROUP_ID !== RAW_VK_GROUP_ID) console.warn(`ENV VK_GROUP_ID="${RAW_VK_GROUP_ID}" — минус убран, используется ${VK_GROUP_ID}`);
if (!/^\d+$/.test(VK_GROUP_ID)) console.warn(`ENV VK_GROUP_ID="${VK_GROUP_ID}" — ожидается числовой ID сообщества; проверка group_id входящих событий отключена`);
const VK_SECRET_KEY      = required('VK_SECRET_KEY');
const VK_SERVICE_KEY     = required('VK_SERVICE_KEY');
const TELEGRAM_BOT_TOKEN = required('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = required('TELEGRAM_CHAT_ID');

// Содержимое JSON-файла сервисного аккаунта Firebase (Project Settings → Service accounts →
// Generate new private key), целиком как одна строка — см. src/lib/db.js.
const FIREBASE_SERVICE_ACCOUNT = required('FIREBASE_SERVICE_ACCOUNT');

// ID базы Firestore. Подтверждено на реальном проекте: если база создана не через старый флоу
// автосоздания единственной специальной "(default)"-базы, а с явным ID (Firebase Console сейчас
// предлагает ввести ID при создании), клиент должен стучаться именно в него — иначе
// admin.firestore()/getFirestore(app) без явного ID ищет несуществующую "(default)" и падает.
// "default" — то, что сработало при отладке этого проекта; если у вас классическая "(default)"
// база, переопределите этой переменной.
const FIREBASE_FIRESTORE_DATABASE_ID = process.env.FIREBASE_FIRESTORE_DATABASE_ID || 'default';

const LEAD_CHAT_ID   = process.env.LEAD_CHAT_ID || null;
const DEBUG_CHAT_ID  = process.env.DEBUG_CHAT_ID || null;
const STATS_CHAT_ID  = process.env.STATS_CHAT_ID || null;
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE || null;

// Начальные ID тем (message_thread_id) форум-супергруппы по ролям уведомлений — см.
// src/telegram.js (resolveRoleTarget) и src/state.js (state.topics). Опциональны: без них
// роль либо шлёт в свой отдельный *_CHAT_ID как раньше, либо (если не задан и *_CHAT_ID) молча
// отключена. Переопределяются в рантайме через /set_topic и персистентны в bot_state.topics.
const TELEGRAM_TOPIC_MAIN_ID  = optionalPositiveNumber('TELEGRAM_TOPIC_MAIN_ID');
const TELEGRAM_TOPIC_LEAD_ID  = optionalPositiveNumber('TELEGRAM_TOPIC_LEAD_ID');
const TELEGRAM_TOPIC_DEBUG_ID = optionalPositiveNumber('TELEGRAM_TOPIC_DEBUG_ID');
const TELEGRAM_TOPIC_STATS_ID = optionalPositiveNumber('TELEGRAM_TOPIC_STATS_ID');

// Если задано — раз в N часов бот сам публикует дайджест статистики (src/lib/stats.js) в роль
// "stats" (см. resolveRoleTarget). Без этой переменной автодайджест выключен, доступен только /stats.
const STATS_DIGEST_HOURS = optionalPositiveNumber('STATS_DIGEST_HOURS');

const BOT_VERSION    = process.env.BOT_VERSION || readPackageVersion() || '0.0.0';

module.exports = {
  VK_GROUP_ID,
  VK_SECRET_KEY,
  VK_SERVICE_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  LEAD_CHAT_ID,
  DEBUG_CHAT_ID,
  STATS_CHAT_ID,
  ADMIN_USER_IDS,
  BOT_VERSION,
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_FIRESTORE_DATABASE_ID,
  VK_CONFIRMATION_CODE,
  TELEGRAM_TOPIC_MAIN_ID,
  TELEGRAM_TOPIC_LEAD_ID,
  TELEGRAM_TOPIC_DEBUG_ID,
  TELEGRAM_TOPIC_STATS_ID,
  STATS_DIGEST_HOURS
};
