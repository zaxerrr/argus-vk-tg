// src/lib/stats.js — статистика поверх bot_logs: выборки из SQL-вьюх (migrations/003_stats_views.sql)
// и форматирование дайджеста. Используется командой /stats (src/commands.js) и опциональным
// автодайджестом STATS_DIGEST_HOURS (server.js).

const { supabase } = require('./db');

async function getOverview24h() {
  const { data, error } = await supabase.from('bot_stats_overview_24h').select('*').maybeSingle();
  if (error) throw error;
  return data || { vk_events_24h: 0, telegram_updates_24h: 0, telegram_sent_24h: 0, errors_24h: 0 };
}

async function getTopVkEventTypes(limit = 10) {
  const { data, error } = await supabase
    .from('bot_stats_vk_events_last_24h')
    .select('vk_event_type, events')
    .order('events', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

function formatDigest(overview, topTypes) {
  const lines = [
    '📊 <b>Статистика за 24 часа</b>',
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

module.exports = { getOverview24h, getTopVkEventTypes, formatDigest };
