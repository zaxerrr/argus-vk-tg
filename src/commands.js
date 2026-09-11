// src/commands.js — регистрация Telegram-команд

const { sendTelegramMessageWithRetry, resolveRoleTarget } = require('./telegram');
const { state, isAdmin, setMainChat, toggleEvent, setTopic, TOPIC_ROLES } = require('./state');
const { escapeHtml } = require('./utils');
const { DEBUG_CHAT_ID, LEAD_CHAT_ID, STATS_CHAT_ID, BOT_VERSION } = require('./config');
const { getOverview24h, getTopVkEventTypes, formatDigest } = require('./lib/stats');
const { db } = require('./lib/db');

// Та же карта, что в src/telegram.js — используется только для предупреждения в /set_topic
// (см. ниже), не для маршрутизации.
const ROLE_CHAT_ENV = { lead: LEAD_CHAT_ID, debug: DEBUG_CHAT_ID, stats: STATS_CHAT_ID };

function registerCommands(bot) {
  // Регистрация меню команд Telegram (автокомплит по "/") — список дублирует /help.
  // Fire-and-forget: не должно блокировать остальную регистрацию обработчиков.
  bot.setMyCommands([
    { command: 'help', description: 'Список команд' },
    { command: 'status', description: 'Статус бота' },
    { command: 'my_chat_id', description: 'ID текущего чата' },
    { command: 'whoami', description: 'Информация о себе' },
    { command: 'ping', description: 'Задержка ответа' },
    { command: 'version', description: 'Версия и аптайм' },
    { command: 'topic_id', description: 'ID темы (thread) текущего сообщения' },
    { command: 'topics', description: 'Темы супергруппы по ролям (админ)' },
    { command: 'set_topic', description: 'Привязать тему к роли (админ)' },
    { command: 'list_events', description: 'Список типов событий VK (админ)' },
    { command: 'toggle_event', description: 'Вкл/выкл тип события (админ)' },
    { command: 'set_main_chat', description: 'Основной чат (админ)' },
    { command: 'send_main', description: 'Отправить сообщение в основной (админ)' },
    { command: 'test_notification', description: 'Тестовое уведомление (админ)' },
    { command: 'stats', description: 'Статистика за сегодня (админ)' },
    { command: 'raw_event', description: 'Сырой JSON последнего VK-события (админ)' }
  ]).catch(e => console.error('Не удалось зарегистрировать команды бота:', e.message));

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
      '/stats — статистика за сегодня (UTC) (админ)',
      '/raw_event [тип] — сырой JSON последнего VK-события из логов (админ)'
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

    // Тема привязана к конкретному чату — если у роли задан отдельный *_CHAT_ID, отличный от
    // чата, где выполнена эта команда, тема, установленная "here", относится не к тому чату:
    // отправка в эту роль будет молча падать ("message thread not found"). См. журнал решений.
    let warning = '';
    const dedicatedChat = ROLE_CHAT_ENV[role];
    if (result !== null && dedicatedChat && String(dedicatedChat) !== String(msg.chat.id)) {
      warning = `\n⚠️ У роли "${role}" задан отдельный чат (<code>${dedicatedChat}</code>), а команда выполнена в чате <code>${msg.chat.id}</code>. Тема применится только к сообщениям в чат <code>${dedicatedChat}</code> — если этот ID темы не из него, отправка будет молча падать. Выполни команду внутри нужной темы именно того чата.`;
    }
    sendTelegramMessageWithRetry(msg.chat.id, `${role}: тема ${desc}${warning}`, { parse_mode: 'HTML' });
  });

  // ==== Статистика ====
  bot.onText(/^\/stats$/, async (msg) => {
    if (!isAdmin(msg.from?.id)) return;
    try {
      // Таймаут — как у /health (server.js) — иначе недоступный Firestore вешает команду без
      // видимого ответа вместо явной ошибки.
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore не ответил за 5с')), 5000));
      const [overview, top] = await Promise.race([
        Promise.all([getOverview24h(), getTopVkEventTypes(10)]),
        timeout
      ]);
      await sendTelegramMessageWithRetry(msg.chat.id, formatDigest(overview, top), { parse_mode: 'HTML' });
    } catch (e) {
      console.error('[commands] /stats failed:', e.message);
      await sendTelegramMessageWithRetry(msg.chat.id, `❌ Не удалось получить статистику: ${escapeHtml(e.message)}`);
    }
  });

  // ==== Диагностика: сырой payload последнего события из bot_logs (Firestore) ====
  bot.onText(/^\/raw_event(?:\s+(\S+))?$/, async (msg, m) => {
    if (!isAdmin(msg.from?.id)) return;
    const wantedType = m[1];
    try {
      // Без фильтра by "==" на payload.type — такой запрос потребовал бы создания составного
      // индекса в Firestore (equality + orderBy на разных полях). Вместо этого читаем последние
      // N записей одним запросом (одно поле сортировки — не требует индекса) и фильтруем в коде.
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore не ответил за 5с')), 5000));
      const snap = await Promise.race([
        db.collection('bot_logs').where('source', '==', 'vk').orderBy('ts', 'desc').limit(30).get(),
        timeout
      ]);
      const doc = snap.docs
        .map(d => d.data())
        .find(r => !wantedType || (r.payload && r.payload.type === wantedType));
      if (!doc) {
        const hint = wantedType ? ` типа <code>${escapeHtml(wantedType)}</code>` : '';
        await sendTelegramMessageWithRetry(msg.chat.id, `Событие${hint} не найдено среди последних 30 VK-записей в bot_logs.`, { parse_mode: 'HTML' });
        return;
      }
      const json = JSON.stringify(doc.payload, null, 2);
      const text = `<b>${escapeHtml(doc.payload?.type || '?')}</b> (${escapeHtml(doc.ts || '')})\n<pre>${escapeHtml(json.slice(0, 3500))}</pre>`;
      await sendTelegramMessageWithRetry(msg.chat.id, text, { parse_mode: 'HTML' });
    } catch (e) {
      console.error('[commands] /raw_event failed:', e.message);
      await sendTelegramMessageWithRetry(msg.chat.id, `❌ Не удалось прочитать bot_logs: ${escapeHtml(e.message)}`);
    }
  });

  // неизвестные команды
  bot.on('message', async (msg) => {
    if (!msg.text) return;
    if (/^\//.test(msg.text) && !/^\/(help|status|my_chat_id|whoami|ping|version|test_notification|list_events|toggle_event|set_main_chat|send_main|topic_id|topics|set_topic|stats|raw_event)\b/.test(msg.text)) {
      await sendTelegramMessageWithRetry(msg.chat.id, 'Команда не найдена. Напиши /help');
    }
  });
}

module.exports = { registerCommands };
