// src/commands.js — регистрация Telegram-команд

const { sendTelegramMessageWithRetry, resolveRoleTarget } = require('./telegram');
const { state, isAdmin, setMainChat, toggleEvent, setTopic, TOPIC_ROLES } = require('./state');
const { escapeHtml } = require('./utils');
const { DEBUG_CHAT_ID, BOT_VERSION } = require('./config');
const { getOverview24h, getTopVkEventTypes, formatDigest } = require('./lib/stats');

function registerCommands(bot) {
  bot.onText(/^\/help$/, async (msg) => {
    const text = [
      '👋 Доступные команды:',
      '/status — статус',
      '/help — помощь',
      '/my_chat_id — ID чата',
      '/whoami — информация о тебе',
      '/ping — задержка',
      '/version — версия и аптайм',
      '/test_notification — тест (админ)',
      '/list_events — список событий (админ)',
      '/toggle_event <тип> — вкл/выкл событие (админ)',
      '/set_main_chat <id> — основной чат (админ)',
      '/send_main <текст> — отправить в основной (админ)',
      '/topic_id — ID темы (thread) текущего сообщения',
      '/topics — темы супергруппы по ролям (админ)',
      '/set_topic <роль> <id|here|off> — привязать тему к роли (админ)',
      '/stats — статистика за 24ч (админ)'
    ].join('\n');
    await sendTelegramMessageWithRetry(msg.chat.id, text);
  });

  bot.onText(/^\/status$/, msg =>
    sendTelegramMessageWithRetry(msg.chat.id, '✅ Бот активен.')
  );

  bot.onText(/^\/my_chat_id$/, msg =>
    sendTelegramMessageWithRetry(msg.chat.id, `ID: <code>${msg.chat.id}</code>`, { parse_mode: 'HTML' })
  );

  bot.onText(/^\/whoami$/, msg => {
    const u = msg.from || {};
    const lines = [
      `Ты: <b>${escapeHtml([u.first_name, u.last_name].filter(Boolean).join(' ') || '—')}</b>`,
      `username: @${u.username || '—'}`,
      `id: <code>${u.id}</code>`,
      `is_admin: <b>${isAdmin(u.id)}</b>`
    ];
    sendTelegramMessageWithRetry(msg.chat.id, lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.onText(/^\/ping$/, async (msg) => {
    const t0 = Date.now();
    const m = await bot.sendMessage(msg.chat.id, 'pong…');
    const dt = Date.now() - t0;
    await bot.editMessageText(`🏓 pong (${dt}ms)`, { chat_id: m.chat.id, message_id: m.message_id });
  });

  bot.onText(/^\/version$/, msg => {
    const started = global.__BOT_STARTED_AT || new Date();
    const uptimeSec = Math.floor((Date.now() - started.getTime()) / 1000);
    const lines = [
      `🟢 Версия: <b>${BOT_VERSION}</b>`,
      `Основной чат: <code>${state.CURRENT_MAIN_CHAT_ID}</code>`,
      `Uptime: ${uptimeSec}s`
    ];
    sendTelegramMessageWithRetry(msg.chat.id, lines.join('\n'), { parse_mode: 'HTML' });
  });

  // ==== Админ-команды ====
  bot.onText(/^\/test_notification$/, msg => {
    if (!isAdmin(msg.from?.id)) return;
    sendTelegramMessageWithRetry(DEBUG_CHAT_ID || msg.chat.id, '🔔 Тестовое уведомление OK');
  });

  bot.onText(/^\/list_events$/, msg => {
    if (!isAdmin(msg.from?.id)) return;
    const lines = ['✨ Статус событий:'];
    Object.keys(state.eventToggleState).sort().forEach(t => {
      lines.push(`${t}: ${state.eventToggleState[t] ? '✅' : '❌'}`);
    });
    sendTelegramMessageWithRetry(msg.chat.id, lines.join('\n'));
  });

  bot.onText(/^\/toggle_event\s+(\S+)$/, (msg, m) => {
    if (!isAdmin(msg.from?.id)) return;
    const key = m[1];
    const newValue = toggleEvent(key);
    if (newValue === null) {
      sendTelegramMessageWithRetry(msg.chat.id, `Неизвестный тип: <code>${escapeHtml(key)}</code>`, { parse_mode: 'HTML' });
      return;
    }
    sendTelegramMessageWithRetry(msg.chat.id, `${key}: ${newValue ? '✅ включено' : '❌ отключено'}`);
  });

  bot.onText(/^\/set_main_chat\s+(-?\d+)$/, (msg, m) => {
    if (!isAdmin(msg.from?.id)) return;
    setMainChat(m[1]);
    sendTelegramMessageWithRetry(msg.chat.id, `Основной чат: <code>${state.CURRENT_MAIN_CHAT_ID}</code>`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/send_main\s+([\s\S]+)$/, (msg, m) => {
    if (!isAdmin(msg.from?.id)) return;
    const text = m[1].trim();
    if (!text) return;
    sendTelegramMessageWithRetry(state.CURRENT_MAIN_CHAT_ID, text);
    sendTelegramMessageWithRetry(msg.chat.id, '✅ Отправлено.');
  });

  // ==== Темы (forum topics) супергруппы ====
  bot.onText(/^\/topic_id$/, msg => {
    const threadId = msg.message_thread_id;
    const text = threadId
      ? `ID темы (thread): <code>${threadId}</code>`
      : 'Это не тема форума (General/обычный чат) — своего ID темы нет.';
    const opts = { parse_mode: 'HTML' };
    if (threadId) opts.message_thread_id = threadId;
    sendTelegramMessageWithRetry(msg.chat.id, text, opts);
  });

  bot.onText(/^\/topics$/, msg => {
    if (!isAdmin(msg.from?.id)) return;
    const lines = ['🧵 Темы по ролям уведомлений:'];
    TOPIC_ROLES.forEach(role => {
      const { chatId, threadId } = resolveRoleTarget(role);
      lines.push(`${role}: чат <code>${chatId || '—'}</code>, тема <code>${threadId ?? '—'}</code>`);
    });
    sendTelegramMessageWithRetry(msg.chat.id, lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.onText(/^\/set_topic\s+(\S+)\s+(here|off|-?\d+)$/, (msg, m) => {
    if (!isAdmin(msg.from?.id)) return;
    const [, role, rawValue] = m;

    let value;
    if (rawValue === 'off') {
      value = null;
    } else if (rawValue === 'here') {
      if (!msg.message_thread_id) {
        sendTelegramMessageWithRetry(msg.chat.id, 'Это не тема форума — нет ID для "here". Выполни команду внутри нужной темы.');
        return;
      }
      value = msg.message_thread_id;
    } else {
      value = Number(rawValue);
    }

    const result = setTopic(role, value);
    if (result === undefined) {
      sendTelegramMessageWithRetry(
        msg.chat.id,
        `Неизвестная роль: <code>${escapeHtml(role)}</code>. Доступные: ${TOPIC_ROLES.join(', ')}`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    const desc = result === null ? 'сброшена (без темы)' : `установлена: <code>${result}</code>`;
    sendTelegramMessageWithRetry(msg.chat.id, `${role}: тема ${desc}`, { parse_mode: 'HTML' });
  });

  // ==== Статистика ====
  bot.onText(/^\/stats$/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    try {
      const [overview, top] = await Promise.all([getOverview24h(), getTopVkEventTypes(10)]);
      await sendTelegramMessageWithRetry(msg.chat.id, formatDigest(overview, top), { parse_mode: 'HTML' });
    } catch (e) {
      await sendTelegramMessageWithRetry(msg.chat.id, `❌ Не удалось получить статистику: ${escapeHtml(e.message)}`);
    }
  });

  // неизвестные команды
  bot.on('message', async (msg) => {
    if (!msg.text) return;
    if (/^\//.test(msg.text) && !/^\/(help|status|my_chat_id|whoami|ping|version|test_notification|list_events|toggle_event|set_main_chat|send_main|topic_id|topics|set_topic|stats)\b/.test(msg.text)) {
      await sendTelegramMessageWithRetry(msg.chat.id, 'Команда не найдена. Напиши /help');
    }
  });
}

module.exports = { registerCommands };
