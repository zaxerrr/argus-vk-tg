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
- Exposes Telegram bot commands (`/status`, `/toggle_event`, `/set_main_chat`, `/set_topic`,
  `/stats`, ...) to inspect and control the bot at runtime; admin-only commands are gated by
  Telegram user ID.
- Routes notifications by role (main/lead/debug/stats) to either separate chats or — if you use a
  single Telegram supergroup with Forum Topics enabled — distinct topics within it.
- Logs structured request/response records to Firestore for observability, with a real-time stats
  digest (on demand via `/stats`, or automatically if `STATS_DIGEST_HOURS` is set).

See [`CLAUDE.md`](./CLAUDE.md) for a deeper description of the request flow and code layout,
[`docs/VK_API.md`](./docs/VK_API.md) for the current VK API version, Callback API confirmation
mechanism, and the full event-type ↔ toggle ↔ handler mapping, and
[`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md) for setting up the Firebase project.

### Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (see comments in the file for where each
   one comes from). All variables under "Обязательные / Required" are mandatory — the process
   exits with code 1 on boot if any is missing (`src/config.js`).
3. Set up Firebase (free Spark plan is enough) — full walkthrough in
   [`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md): create a project, enable Firestore
   (Native mode), generate a service-account key, and put its JSON content into
   `FIREBASE_SERVICE_ACCOUNT`. No migrations to run — collections/documents are created on first
   write.
4. In your VK community settings, point the Callback API at `https://<your-host>/webhook` and set
   the same secret as `VK_SECRET_KEY`.
5. `npm start`

### Deploying

[`render.yaml`](./render.yaml) is a ready-to-use [Render](https://render.com) Blueprint (free
tier) — Render dashboard → New → Blueprint → pick this repo/fork, then fill in the env vars it
prompts for. Note the free plan's web services sleep after ~15 minutes with no inbound HTTP
traffic, which also pauses the bot's Telegram long-polling loop (the whole container stops) — see
the comment at the top of `render.yaml` for the trade-off and a keep-alive workaround. Any other
Node.js host works too, as long as it runs `npm start` and forwards its own `PORT`.

### Forum topics & stats (optional)

Notifications route by role (`main`/`lead`/`debug`/`stats`) rather than a hardcoded chat. By
default each role uses its own chat env var (`TELEGRAM_CHAT_ID`/`LEAD_CHAT_ID`/`DEBUG_CHAT_ID`/
`STATS_CHAT_ID`) — same as before. To use a single Telegram supergroup with Forum Topics enabled
instead: create a topic for each role you want, run `/topic_id` inside it to get its thread ID,
then either set `TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID` in `.env` or run
`/set_topic <role> here` from inside the topic (admin-only). `/topics` shows the resolved
chat+topic per role. A role with neither a dedicated chat nor a topic is simply disabled, so this
is fully opt-in. See `CLAUDE.md` for the resolution order.

`/stats` (admin) posts a digest (VK events, Telegram traffic, errors, top VK event types) for
**today (UTC calendar day)** — real-time Firestore counters, not a rolling 24h window (see
`src/lib/stats.js`). Set `STATS_DIGEST_HOURS` to also post it automatically on that interval to
the `stats` role.

### Commands

- `npm start` — run the bot (`node server.js`)
- `npm test` — run the test suite (`node --test`, with dummy env vars preloaded via
  `test/setupEnv.js` so tests don't need a real `.env`)

### Health check

`GET /health` returns `{ ok, uptime_sec, ts, firestore }` — `firestore` reflects a live
(2s-timeout) connectivity check against the `bot_logs` collection, useful for readiness probes.

### Known limitations

- Long-polling (`node-telegram-bot-api`) means only **one instance** of the bot should run against
  a given bot token at a time — running two causes a 409 conflict from Telegram.
- `handlers/`, `utils/index.js`, `src/lib/events.js`, and `src/storage/{firebase,redis,supabase}.js`
  are unwired legacy/scaffold code, not part of the running bot — see `CLAUDE.md` for details.
  (`src/storage/firebase.js` is not the live Firebase integration despite the name — that's
  `src/lib/db.js`.)
- `src/worker.js` / `wrangler.jsonc` are an unfinished Cloudflare Worker migration stub.
- `/stats` resets at UTC midnight (calendar-day counters) rather than a true rolling 24h window —
  see `src/lib/stats.js`.

---

## Русский

### Что делает

- Принимает события VK Callback API на `POST /webhook`.
- Отбрасывает повторные события (VK повторяет запрос, если не получает быстрый `ok`).
- Формирует короткое HTML-уведомление под каждый тип события (новые посты, комментарии, лайки
  с актуальным счётчиком, вступления/выходы из группы, заказы в маркете и т.д.) и отправляет его
  в Telegram-чат через long-polling.
- Предоставляет команды Telegram-бота (`/status`, `/toggle_event`, `/set_main_chat`,
  `/set_topic`, `/stats` и др.) для просмотра и управления ботом в рантайме; админ-команды
  защищены проверкой Telegram user ID.
- Маршрутизирует уведомления по ролям (main/lead/debug/stats) — либо в отдельные чаты, либо (если
  используется одна Telegram-супергруппа с включёнными темами) в отдельные темы внутри неё.
- Пишет структурированные записи запросов/ответов в Firestore для наблюдаемости, со статистикой
  в реальном времени (по запросу `/stats` или автоматически, если задан `STATS_DIGEST_HOURS`).

Подробнее о потоке обработки запроса и структуре кода — в [`CLAUDE.md`](./CLAUDE.md), актуальная
версия VK API, механизм подтверждения Callback API и полная карта событий — в
[`docs/VK_API.md`](./docs/VK_API.md), а настройка проекта Firebase — в
[`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md).

### Установка

1. `npm install`
2. Скопируйте `.env.example` в `.env` и заполните значения (см. комментарии в файле, откуда их
   брать). Все переменные из раздела «Обязательные» строго обязательны — процесс завершится с
   кодом 1 при старте, если хотя бы одна отсутствует (`src/config.js`).
3. Настройте Firebase (бесплатного тарифа Spark достаточно) — полная инструкция в
   [`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md): создать проект, включить Firestore
   (Native mode), сгенерировать ключ сервисного аккаунта и вставить его JSON в
   `FIREBASE_SERVICE_ACCOUNT`. Миграции запускать не нужно — коллекции/документы создаются при
   первой записи.
4. В настройках сообщества VK укажите для Callback API адрес `https://<ваш-хост>/webhook` и тот
   же секрет, что и в `VK_SECRET_KEY`.
5. `npm start`

### Деплой

[`render.yaml`](./render.yaml) — готовый Blueprint для [Render](https://render.com) (бесплатный
тариф): в дашборде Render → New → Blueprint → выбрать этот репозиторий/форк, затем заполнить
переменные, которые он запросит. На бесплатном тарифе веб-сервис «засыпает» примерно через 15
минут без входящих HTTP-запросов, что также останавливает long-polling бота (контейнер целиком
останавливается) — компромисс и обходной путь (keep-alive) описаны в комментарии в начале
`render.yaml`. Подойдёт и любой другой Node.js-хостинг — достаточно, чтобы он запускал
`npm start` и передавал свой `PORT`.

### Темы (forum topics) и статистика (опционально)

Уведомления маршрутизируются по роли (`main`/`lead`/`debug`/`stats`), а не по жёстко заданному
чату. По умолчанию каждая роль использует свою переменную чата (`TELEGRAM_CHAT_ID`/
`LEAD_CHAT_ID`/`DEBUG_CHAT_ID`/`STATS_CHAT_ID`) — как и раньше. Чтобы вместо этого использовать
одну Telegram-супергруппу с включёнными темами (Forum Topics): создайте тему для каждой нужной
роли, выполните в ней `/topic_id`, чтобы получить её thread ID, затем либо задайте
`TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID` в `.env`, либо выполните `/set_topic <роль> here`
прямо в теме (только админ). `/topics` покажет итоговый чат+тему по каждой роли. Роль без
отдельного чата и без темы просто отключена — фича полностью опциональна. Порядок разрешения —
в `CLAUDE.md`.

`/stats` (админ) публикует дайджест (события VK, трафик Telegram, ошибки, топ типов событий VK)
за **сегодня (календарные сутки UTC)** — счётчики Firestore в реальном времени, а не скользящее
окно 24ч (см. `src/lib/stats.js`). Задайте `STATS_DIGEST_HOURS`, чтобы дайджест публиковался
автоматически с этим интервалом в роль `stats`.

### Команды

- `npm start` — запуск бота (`node server.js`)
- `npm test` — запуск тестов (`node --test`; заглушки env-переменных подгружаются через
  `test/setupEnv.js`, поэтому реальный `.env` для тестов не нужен)

### Health-check

`GET /health` возвращает `{ ok, uptime_sec, ts, firestore }` — поле `firestore` отражает живую
проверку связи с коллекцией `bot_logs` (с таймаутом 2с), полезно для readiness-проб.

### Известные ограничения

- Long-polling (`node-telegram-bot-api`) означает, что на один токен бота должен работать **только
  один** инстанс — два одновременно вызовут конфликт 409 от Telegram.
- `handlers/`, `utils/index.js`, `src/lib/events.js` и `src/storage/{firebase,redis,supabase}.js` —
  неподключённый старый/заготовочный код, не часть работающего бота — подробности в `CLAUDE.md`.
  (`src/storage/firebase.js`, несмотря на название, — не настоящая интеграция Firebase, это
  `src/lib/db.js`.)
- `src/worker.js` / `wrangler.jsonc` — незавершённая заготовка миграции на Cloudflare Worker.
- `/stats` обнуляется в полночь UTC (счётчик за календарные сутки), а не скользящее окно 24ч —
  см. `src/lib/stats.js`.
