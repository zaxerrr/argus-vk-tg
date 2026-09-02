# vk-telegram-bot

Пересылка событий VK Callback API в Telegram с логированием и настраиваемыми уведомлениями.

Forwards VK (VKontakte) Callback API webhook events to Telegram as formatted notifications, with
structured logging and runtime-configurable event filtering.

**Language / Язык:** [English](#english) · [Русский](#русский)

---

## English

### What it does

- Receives VK Callback API events on `POST /webhook`.
- Deduplicates retried events (VK retries if it doesn't get a fast `ok`).
- Formats a short HTML notification per event type (new posts, comments, likes with live
  counters, group joins/leaves, market orders, etc.) and sends it to a Telegram chat via
  long-polling.
- Exposes Telegram bot commands (`/status`, `/toggle_event`, `/set_main_chat`, ...) to inspect
  and control the bot at runtime; admin-only commands are gated by Telegram user ID.
- Logs structured request/response records to a Supabase table for observability.

See [`CLAUDE.md`](./CLAUDE.md) for a deeper description of the request flow and code layout, and
[`docs/VK_API.md`](./docs/VK_API.md) for the current VK API version, Callback API confirmation
mechanism, and the full event-type ↔ toggle ↔ handler mapping.

### Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (see comments in the file for where each
   one comes from). All variables under "Обязательные / Required" are mandatory — the process
   exits with code 1 on boot if any is missing (`src/config.js`).
3. In your Supabase project's SQL editor, run [`migrations/001_bot_state.sql`](./migrations/001_bot_state.sql)
   once. It creates:
   - `bot_logs` — structured logs written by `src/lib/logger.js`.
   - `bot_state` — persists the event on/off toggles and the active Telegram chat ID
     (`src/state.js`), so they survive restarts instead of resetting to defaults.
4. In your VK community settings, point the Callback API at `https://<your-host>/webhook` and set
   the same secret as `VK_SECRET_KEY`.
5. `npm start`

### Commands

- `npm start` — run the bot (`node server.js`)
- `npm test` — run the test suite (`node --test`, with dummy env vars preloaded via
  `test/setupEnv.js` so tests don't need a real `.env`)

### Health check

`GET /health` returns `{ ok, uptime_sec, ts, supabase }` — `supabase` reflects a live (2s-timeout)
connectivity check against the `bot_logs` table, useful for readiness probes.

### Known limitations

- Long-polling (`node-telegram-bot-api`) means only **one instance** of the bot should run against
  a given bot token at a time — running two causes a 409 conflict from Telegram.
- `handlers/`, `utils/index.js`, `src/lib/events.js`, and `src/storage/{firebase,redis,supabase}.js`
  are unwired legacy/scaffold code, not part of the running bot — see `CLAUDE.md` for details.
- `src/worker.js` / `wrangler.jsonc` are an unfinished Cloudflare Worker migration stub.

---

## Русский

### Что делает

- Принимает события VK Callback API на `POST /webhook`.
- Отбрасывает повторные события (VK повторяет запрос, если не получает быстрый `ok`).
- Формирует короткое HTML-уведомление под каждый тип события (новые посты, комментарии, лайки
  с актуальным счётчиком, вступления/выходы из группы, заказы в маркете и т.д.) и отправляет его
  в Telegram-чат через long-polling.
- Предоставляет команды Telegram-бота (`/status`, `/toggle_event`, `/set_main_chat` и др.) для
  просмотра и управления ботом в рантайме; админ-команды защищены проверкой Telegram user ID.
- Пишет структурированные записи запросов/ответов в таблицу Supabase для наблюдаемости.

Подробнее о потоке обработки запроса и структуре кода — в [`CLAUDE.md`](./CLAUDE.md), а актуальная
версия VK API, механизм подтверждения Callback API и полная карта событий — в
[`docs/VK_API.md`](./docs/VK_API.md).

### Установка

1. `npm install`
2. Скопируйте `.env.example` в `.env` и заполните значения (см. комментарии в файле, откуда их
   брать). Все переменные из раздела «Обязательные» строго обязательны — процесс завершится с
   кодом 1 при старте, если хотя бы одна отсутствует (`src/config.js`).
3. В SQL-редакторе вашего проекта Supabase выполните один раз
   [`migrations/001_bot_state.sql`](./migrations/001_bot_state.sql). Он создаёт:
   - `bot_logs` — структурированные логи из `src/lib/logger.js`.
   - `bot_state` — хранит тумблеры событий и текущий ID основного Telegram-чата (`src/state.js`),
     чтобы они не сбрасывались к дефолтам при каждом рестарте.
4. В настройках сообщества VK укажите для Callback API адрес `https://<ваш-хост>/webhook` и тот
   же секрет, что и в `VK_SECRET_KEY`.
5. `npm start`

### Команды

- `npm start` — запуск бота (`node server.js`)
- `npm test` — запуск тестов (`node --test`; заглушки env-переменных подгружаются через
  `test/setupEnv.js`, поэтому реальный `.env` для тестов не нужен)

### Health-check

`GET /health` возвращает `{ ok, uptime_sec, ts, supabase }` — поле `supabase` отражает живую
проверку связи с таблицей `bot_logs` (с таймаутом 2с), полезно для readiness-проб.

### Известные ограничения

- Long-polling (`node-telegram-bot-api`) означает, что на один токен бота должен работать **только
  один** инстанс — два одновременно вызовут конфликт 409 от Telegram.
- `handlers/`, `utils/index.js`, `src/lib/events.js` и `src/storage/{firebase,redis,supabase}.js` —
  неподключённый старый/заготовочный код, не часть работающего бота — подробности в `CLAUDE.md`.
- `src/worker.js` / `wrangler.jsonc` — незавершённая заготовка миграции на Cloudflare Worker.
