# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Этот файл содержит указания для Claude Code (claude.ai/code) при работе с кодом этого репозитория.

**Language / Язык:** [English](#english) · [Русский](#русский)

---

## English

### What this is

A Node.js bot that receives VK (VKontakte) Callback API webhook events and forwards them as
formatted notifications to Telegram via long-polling (`node-telegram-bot-api`). Entry point is
`server.js`, an Express app. Most code comments and user-facing bot strings are in Russian.

### Commands

- `npm start` — run the bot (`node server.js`)
- `npm test` — run the test suite (`node --test`, Node's built-in test runner; `test/setupEnv.js`
  is preloaded via `--require` to stub the required env vars, so tests don't need a real `.env`)
- `node --test test/vk/dedup.test.js` — run a single test file
- No lint/build step is configured.

#### Required environment variables

`server.js` boots through `src/config.js`, which calls `process.exit(1)` if any of these are
missing: `VK_GROUP_ID`, `VK_SECRET_KEY`, `VK_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `FIREBASE_SERVICE_ACCOUNT` (the full JSON of a Firebase service-account key,
as one string — see `docs/FIREBASE_SETUP.md`). Optional: `FIREBASE_FIRESTORE_DATABASE_ID`
(defaults to `default` — `src/lib/db.js` always passes a Firestore database ID explicitly rather
than relying on the `getFirestore(app)` default of the special `(default)` database, which this
project's database is *not* named — see the warning in `docs/FIREBASE_SETUP.md`), `LEAD_CHAT_ID`, `DEBUG_CHAT_ID`,
`STATS_CHAT_ID`, `TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID` (forum-topic thread IDs — see
[Forum topics](#forum-topics-single-supergroup) below), `STATS_DIGEST_HOURS`, `ADMIN_USER_IDS`
(comma-separated Telegram user IDs), `BOT_VERSION` (falls back to `package.json` version), `PORT`
(default 3000, but hosting providers that inject their own `PORT` — e.g. Render — take priority).
See `.env.example` for a filled-in template. No migrations to run: Firestore collections/documents
are created on first write (`docs/FIREBASE_SETUP.md` lists what gets created and by which module).

### Request flow (the live code path)

```
VK Callback API → POST /webhook (server.js) → per-IP rate limit (src/security/rateLimit.js) → timing-safe secret check (VK_SECRET_KEY, crypto.timingSafeEqual) → respond "ok" immediately (VK requires a fast ack or it retries) → src/vk/dedup.js: shouldProcessEvent / rememberEvent (in-memory NodeCache, 10 min TTL, md5 hash of {type, objectId, groupId, date}) → src/vk/events.js: handleVkEvent({ type, object }) → checks src/state.js eventToggleState (per-type on/off, runtime-mutable via Telegram commands) → builds a short HTML message (emoji + VK deep link + optional live like counter fetched from VK API) per event type via a big switch statement, using pure link/declension helpers from src/vk/format.js → src/telegram.js: sendToRole('main'|'lead', …) resolves the target chat + optional forum-topic message_thread_id (see below) → sendTelegramMessageWithRetry (3 retries, 1s/2s/3s backoff, failures echoed to the "debug" role and logged via src/lib/logger.js)
```

Telegram → bot commands are registered in `src/commands.js` via `bot.onText`, using the same
long-polling `bot` instance from `src/telegram.js`. Admin-only commands check
`isAdmin()` (`src/state.js`) against `ADMIN_USER_IDS`.

The dedup cache is still in-process memory only (resets on restart — acceptable, since duplicates
are only a risk within VK's short retry window). `eventToggleState`, `CURRENT_MAIN_CHAT_ID`, and
`topics`, however, are persisted to the Firestore document `bot_state/main` via
`src/lib/stateStore.js`: loaded once on boot (`loadPersistedState()`, awaited before `app.listen`)
and saved on every `toggleEvent()`/`setMainChat()`/`setTopic()` call. If Firestore is unreachable,
load/save fail silently (logged, not thrown) and the in-memory defaults from `src/state.js` are
used for that run.

### Important: two dead/unwired code paths

Several files exist in the repo but are **not imported by `server.js`** and are not part of the
running bot. Don't assume changes to them affect behavior, and don't extend them without wiring
them in (or ask before doing so):

- **`handlers/` and `utils/index.js`** — an older, differently-structured implementation of the
  same event handling (dependency-injection style: each handler receives a context object of
  helper functions). Superseded by the consolidated switch statement in `src/vk/events.js`, which
  has diverged since (different message formats, more event types).
- **`src/lib/events.js` and `src/storage/{firebase,redis,supabase}.js`** — written as ES modules
  (`import`/`export`) in a project that is otherwise CommonJS (`require`/`module.exports`, no
  `"type": "module"` in `package.json`). They also depend on `pino` and `@upstash/redis`, neither
  of which is in `package.json`'s dependencies. Loading these via `require()` will throw. Note
  `src/storage/firebase.js` specifically: despite the name, it is **not** related to the live
  Firebase integration — the real one is `src/lib/db.js` (CommonJS, `firebase-admin`). Only
  `src/lib/db.js` and `src/lib/logger.js` are actually wired into `server.js`, for structured
  request/response logging to the `bot_logs` Firestore collection.

If asked to work on logging, dedup, or event-forwarding logic, the source of truth is
`src/vk/events.js`, `src/vk/dedup.js`, `src/lib/logger.js`, and `src/lib/db.js` — not the files
above.

### Cloudflare Worker target

`wrangler.jsonc` points to `src/worker.js`, which is currently just a placeholder `fetch` handler
returning static text — it does not run the actual bot logic (long-polling isn't viable in a
Workers environment). Treat this as a stub/unfinished migration target, not a working deployment.

### Forum topics (single supergroup)

Notifications are routed by **role** (`main`, `lead`, `debug`, `stats`), not by hardcoded chat ID.
`resolveRoleTarget(role)` in `src/telegram.js` decides, in order: (1) `main` always goes to
`state.CURRENT_MAIN_CHAT_ID`; (2) any other role with its own `*_CHAT_ID` env var
(`LEAD_CHAT_ID`/`DEBUG_CHAT_ID`/`STATS_CHAT_ID`) goes to that chat — the original multi-chat setup;
(3) a role with no dedicated chat but with a configured `message_thread_id` (`state.topics[role]`)
goes into that **forum topic of the main chat** — the "single supergroup with topics" setup; (4)
otherwise the role is disabled (no-op), same as leaving `DEBUG_CHAT_ID` unset used to mean. This
means **the feature is opt-in and backward compatible**: a deployment that never touches topics
behaves exactly as before.

`sendToRole(role, html, options)` is the high-level sender (`src/vk/events.js`'s `notifyMAIN`/
`notifyLEAD` and the digest/startup code in `server.js` use it); `sendTelegramMessageWithRetry`
stays the low-level primitive when you already have a concrete chat ID. Topic IDs are configured
either via env vars (`TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID`, read once into `state.topics` at
boot) or at runtime via the `/set_topic <role> <thread_id|here|off>` admin command (persisted to
the Firestore document `bot_state/main`, field `topics`); `/topic_id` reports the
`message_thread_id` of whatever topic it's run in (use it to discover IDs), and `/topics` lists
the resolved chat+thread per role.

### Statistics (`src/lib/stats.js`)

No SQL views here (Firestore is NoSQL) — instead, `bumpStatsCounters()` atomically increments
fields on today's `stats_daily/<YYYY-MM-DD>` (UTC) document every time `src/lib/logger.js` writes a
log record, keyed off `source`/`event`/`level`; VK event types go into a `vk_event_types` map
(field-path segment sanitized against the untrusted webhook `type` before use — see the function's
comment). This means `/stats` is a **calendar-day counter reset at UTC midnight**, not the old
Supabase version's rolling 24-hour SQL aggregate — deliberate trade-off for minimal Firestore
reads/writes on the free (Spark) tier; no historical/daily-trend queries. `getOverview24h()` /
`getTopVkEventTypes()` read that one document; `formatDigest` is pure and unit-tested
(`test/lib/stats.test.js`). The `/stats` admin command sends it on demand; if `STATS_DIGEST_HOURS`
is set, `server.js` also posts it automatically on that interval to the `stats` role (see Forum
topics above) — unset by default, so existing deployments get no new automatic messages unless
explicitly opted in.

### VK API reference

`docs/VK_API.md` is the maintained source of truth for the VK API version/base URL in use, the
Callback API confirmation mechanism, and — most importantly — a table cross-checking every VK
event type against its `state.eventToggleState` key and `handleVkEvent()` switch `case`. **Update
that file in the same change** whenever you touch VK event handling (`src/vk/events.js`,
`src/state.js`, `src/utils.js`, `src/vk/format.js`) — it's what catches the toggle/case drift
described below before it ships.

### Adding a new VK event type

1. Add the event type key to `state.eventToggleState` in `src/state.js` (defaults it to
   delivered/suppressed).
2. Add a `case` in the switch in `src/vk/events.js` `handleVkEvent()`, following the existing
   style: short emoji-prefixed HTML message, `userLink()` for VK profile links,
   `buildObjectLink()`/`absOwner()` for VK deep links where applicable (imported from
   `src/vk/format.js`).
3. If the message needs a declined noun (Russian grammatical case), extend
   `objNounDative`/`objNounAblative` in `src/vk/format.js` rather than hardcoding text inline.
4. Keep the toggle key and the switch `case` in sync — every key declared in
   `state.eventToggleState` should have a matching `case`, otherwise it silently falls through to
   the generic `❓ <type>` default message.

### Testing conventions

Tests use Node's built-in `node:test` + `node:assert/strict` (see `test/vk/dedup.test.js`), not
Jest/Mocha. Place new tests under `test/`, mirroring the `src/` path being tested.

`src/vk/events.js` requires `src/telegram.js`, which starts a real long-polling `TelegramBot` as a
side effect of being `require()`'d. **Never `require('../events')` (or anything that pulls in
`src/telegram.js`) directly from a test** — it'll try to poll Telegram with whatever token is in
the environment. Pure logic that's worth unit-testing (link building, noun declension) lives in
`src/vk/format.js`, which has zero side-effecting imports — test against that module instead (see
`test/vk/format.test.js`). `src/config.js` has the same problem in miniature: it calls
`process.exit(1)` at `require()` time if an env var is missing, so `test/config.test.js` exercises
it via `child_process.spawnSync` in an isolated process rather than requiring it in-process.

### Known open issue: `node-telegram-bot-api@0.66.0`

`npm audit` reports a critical advisory (unsafe randomness / CRLF injection in `form-data`) via
this package's deprecated transitive `request` dependency. The fix is the `1.x` release, which is
a full TypeScript rewrite with a different API surface — don't bump it casually. Any upgrade needs
deliberate testing of `bot.onText`, `bot.sendMessage`, `bot.editMessageText`, and polling behavior
against a real bot token before merging. CI runs `npm audit` as a non-blocking, informational step
(`continue-on-error: true` in `.github/workflows/ci.yml`) for exactly this reason.

---

## Русский

### Что это такое

Node.js-бот, который принимает события VK Callback API (вебхуки) и пересылает их в виде
форматированных уведомлений в Telegram через long-polling (`node-telegram-bot-api`). Точка входа —
`server.js`, приложение на Express. Большинство комментариев в коде и текстов, видимых
пользователю, написаны на русском языке.

### Команды

- `npm start` — запуск бота (`node server.js`)
- `npm test` — запуск тестов (`node --test`; заглушки обязательных переменных окружения
  подгружаются через `--require test/setupEnv.js`, поэтому реальный `.env` для тестов не нужен)
- `node --test test/vk/dedup.test.js` — запуск одного тестового файла
- Шаг линтинга/сборки не настроен.

#### Обязательные переменные окружения

`server.js` запускается через `src/config.js`, который вызывает `process.exit(1)`, если
отсутствует хотя бы одна из переменных: `VK_GROUP_ID`, `VK_SECRET_KEY`, `VK_SERVICE_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `FIREBASE_SERVICE_ACCOUNT` (весь JSON сервисного
аккаунта Firebase одной строкой — см. `docs/FIREBASE_SETUP.md`). Необязательные:
`FIREBASE_FIRESTORE_DATABASE_ID` (по умолчанию `default` — `src/lib/db.js` всегда передаёт ID базы
Firestore явно, а не полагается на дефолт `getFirestore(app)`, который ищет специальную базу
`(default)` — а база этого проекта называется иначе, см. предупреждение в
`docs/FIREBASE_SETUP.md`), `LEAD_CHAT_ID`,
`DEBUG_CHAT_ID`, `STATS_CHAT_ID`, `TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID` (ID тем форума —
см. [Темы супергруппы](#темы-forum-topics-единая-супергруппа) ниже), `STATS_DIGEST_HOURS`,
`ADMIN_USER_IDS` (ID пользователей Telegram через запятую), `BOT_VERSION` (по умолчанию берётся
версия из `package.json`), `PORT` (по умолчанию 3000, но хостинги со своим `PORT` — например,
Render — имеют приоритет). См. `.env.example` для готового шаблона. Миграции запускать не нужно:
коллекции/документы Firestore создаются при первой записи (что и каким модулем создаётся —
`docs/FIREBASE_SETUP.md`).

### Поток обработки запроса (реальный рабочий путь кода)

```
VK Callback API → POST /webhook (server.js) → rate limit по IP (src/security/rateLimit.js) → timing-safe проверка секрета (VK_SECRET_KEY, crypto.timingSafeEqual) → немедленный ответ "ok" (VK требует быстрого подтверждения, иначе повторяет запрос) → src/vk/dedup.js: shouldProcessEvent / rememberEvent (кэш NodeCache в памяти процесса, TTL 10 минут, md5-хэш от {type, objectId, groupId, date}) → src/vk/events.js: handleVkEvent({ type, object }) → проверка src/state.js eventToggleState (вкл/выкл по типу события, изменяется в рантайме через команды Telegram) → формирование короткого HTML-сообщения (эмодзи + прямая ссылка VK + опциональный актуальный счётчик лайков из VK API) для каждого типа события через большой switch, с использованием чистых хелперов ссылок/склонений из src/vk/format.js → src/telegram.js: sendToRole('main'|'lead', …) определяет целевой чат + опциональный message_thread_id темы форума (см. ниже) → sendTelegramMessageWithRetry (3 попытки, задержки 1с/2с/3с, ошибки дублируются в роль "debug" и логируются через src/lib/logger.js)
```

Команды Telegram → бот регистрируются в `src/commands.js` через `bot.onText`, используя тот же
экземпляр `bot` (long-polling) из `src/telegram.js`. Команды только для администратора проверяют
`isAdmin()` (`src/state.js`) по списку `ADMIN_USER_IDS`.

Кэш дедупликации по-прежнему живёт только в памяти процесса и сбрасывается при рестарте (это
приемлемо — дубликаты возможны только в коротком окне повторов VK). А вот `eventToggleState`,
`CURRENT_MAIN_CHAT_ID` и `topics` теперь персистентны — хранятся в документе Firestore
`bot_state/main` через `src/lib/stateStore.js`: загружаются один раз при старте
(`loadPersistedState()`, ожидается перед `app.listen`) и сохраняются при каждом вызове
`toggleEvent()`/`setMainChat()`/`setTopic()`. Если Firestore недоступен, загрузка/сохранение молча
падают (с логированием, без исключения), и на этот запуск используются дефолты из `src/state.js`.

### Важно: два «мёртвых»/неподключённых участка кода

В репозитории есть файлы, которые **не импортируются в `server.js`** и не участвуют в работе
бота. Не считайте, что изменения в них влияют на поведение бота, и не расширяйте их без явного
подключения (либо сначала уточните это):

- **`handlers/` и `utils/index.js`** — более старая реализация той же обработки событий в другом
  стиле (dependency injection: каждый обработчик получает объект-контекст со вспомогательными
  функциями). Заменена консолидированным switch-оператором в `src/vk/events.js`, который с тех
  пор разошёлся с этой версией (другие форматы сообщений, больше типов событий).
- **`src/lib/events.js` и `src/storage/{firebase,redis,supabase}.js`** — написаны как ES-модули
  (`import`/`export`) в проекте, который в остальном использует CommonJS (`require`/
  `module.exports`, в `package.json` нет `"type": "module"`). Они также зависят от `pino` и
  `@upstash/redis`, которых нет среди зависимостей в `package.json`. Загрузка этих файлов через
  `require()` приведёт к ошибке. Отдельно: `src/storage/firebase.js`, несмотря на название, **не
  связан** с реальной интеграцией Firebase — настоящая живёт в `src/lib/db.js` (CommonJS,
  `firebase-admin`). В `server.js` реально подключены только `src/lib/db.js` и `src/lib/logger.js`
  — для структурированного логирования запросов/ответов в коллекцию Firestore `bot_logs`.

Если стоит задача по логированию, дедупликации или пересылке событий — источником истины являются
`src/vk/events.js`, `src/vk/dedup.js`, `src/lib/logger.js` и `src/lib/db.js`, а не файлы, указанные
выше.

### Cloudflare Worker

`wrangler.jsonc` указывает на `src/worker.js`, который сейчас является лишь заглушкой-обработчиком
`fetch`, возвращающей статичный текст — реальная логика бота там не выполняется (long-polling
невозможна в среде Workers). Считайте это незавершённой целью миграции, а не рабочим
развёртыванием.

### Темы (forum topics), единая супергруппа

Уведомления маршрутизируются по **роли** (`main`, `lead`, `debug`, `stats`), а не по жёстко
зашитому chat ID. `resolveRoleTarget(role)` в `src/telegram.js` решает по порядку: (1) `main`
всегда идёт в `state.CURRENT_MAIN_CHAT_ID`; (2) любая другая роль со своей переменной
`*_CHAT_ID` (`LEAD_CHAT_ID`/`DEBUG_CHAT_ID`/`STATS_CHAT_ID`) идёт в этот чат — старая схема с
несколькими чатами; (3) роль без отдельного чата, но с заданным `message_thread_id`
(`state.topics[role]`), идёт в **эту тему основного чата** — схема «одна супергруппа с темами»;
(4) иначе роль отключена (no-op) — так же, как раньше означал незаданный `DEBUG_CHAT_ID`. То
есть **фича опциональна и обратно совместима**: развёртывание, которое не трогает темы, ведёт
себя ровно как раньше.

`sendToRole(role, html, options)` — высокоуровневый отправитель (используется `notifyMAIN`/
`notifyLEAD` в `src/vk/events.js` и кодом дайджеста/стартового сообщения в `server.js`);
`sendTelegramMessageWithRetry` остаётся низкоуровневым примитивом, когда chat ID уже известен
явно. ID тем задаются либо через переменные окружения (`TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID`,
читаются один раз в `state.topics` при старте), либо в рантайме командой
`/set_topic <роль> <thread_id|here|off>` (персистентно в документе Firestore `bot_state/main`,
поле `topics`); `/topic_id` показывает `message_thread_id` темы, в которой выполнена — так удобно
узнавать ID; `/topics` показывает итоговый чат+тему по каждой роли.

### Статистика (`src/lib/stats.js`)

SQL-вьюх здесь нет (Firestore — NoSQL): вместо них `bumpStatsCounters()` атомарно инкрементирует
поля в документе `stats_daily/<YYYY-MM-DD>` (UTC) за сегодня при каждой записи лога в
`src/lib/logger.js`, ориентируясь на `source`/`event`/`level`; типы событий VK попадают в карту
`vk_event_types` (сегмент пути поля санитизируется против недоверенного `type` из вебхука — см.
комментарий у функции). Это значит, что `/stats` — **счётчик за календарные сутки, обнуляемый в
полночь UTC**, а не скользящий 24-часовой SQL-агрегат прежней Supabase-версии — осознанный
компромисс ради минимума чтений/записей на бесплатном (Spark) тарифе Firestore; истории/дневных
трендов больше нет. `getOverview24h()`/`getTopVkEventTypes()` читают этот один документ;
`formatDigest` — чистая функция, покрыта тестом (`test/lib/stats.test.js`). Админ-команда `/stats`
шлёт его по запросу; если задан `STATS_DIGEST_HOURS`, `server.js` также публикует его
автоматически с этим интервалом в роль `stats` (см. «Темы» выше) — по умолчанию не задан, так что
у существующих развёртываний новые автоматические сообщения не появляются без явного включения.

### Справочник по VK API

`docs/VK_API.md` — поддерживаемый источник истины по используемой версии VK API/базовому URL,
механизму подтверждения Callback API и, самое важное, по таблице соответствия «тип события VK ↔
ключ в `state.eventToggleState` ↔ `case` в `handleVkEvent()`». **Обновляйте этот файл в том же
изменении**, где трогаете обработку VK-событий (`src/vk/events.js`, `src/state.js`,
`src/utils.js`, `src/vk/format.js`) — именно он ловит рассинхронизацию тумблер/case до того, как
она уедет в прод.

### Добавление нового типа события VK

1. Добавьте ключ типа события в `state.eventToggleState` в `src/state.js` (задав значение по
   умолчанию — доставлять/подавлять).
2. Добавьте `case` в switch внутри `handleVkEvent()` в `src/vk/events.js`, следуя существующему
   стилю: короткое HTML-сообщение с эмодзи, `userLink()` для ссылок на профиль VK,
   `buildObjectLink()`/`absOwner()` для прямых ссылок VK, где это применимо (импортируются из
   `src/vk/format.js`).
3. Если в сообщении нужно склонение существительного (падежи русского языка), расширяйте
   `objNounDative`/`objNounAblative` в `src/vk/format.js`, а не вставляйте текст напрямую.
4. Держите ключ тумблера и `case` в switch синхронизированными — каждый ключ, объявленный в
   `state.eventToggleState`, должен иметь соответствующий `case`, иначе он молча попадёт в общий
   дефолтный `❓ <type>`.

### Соглашения по тестированию

Тесты используют встроенные `node:test` + `node:assert/strict` (см. `test/vk/dedup.test.js`), а не
Jest/Mocha. Новые тесты размещайте в `test/`, повторяя структуру пути в `src/`, который
тестируется.

`src/vk/events.js` требует `src/telegram.js`, который при `require()` как побочный эффект
поднимает реальный long-polling `TelegramBot`. **Никогда не делайте `require('../events')` (или
что-либо, что тянет `src/telegram.js`) напрямую в тесте** — он попытается поллить Telegram с тем
токеном, что окажется в окружении. Чистая логика, которую стоит тестировать (построение ссылок,
склонение существительных), вынесена в `src/vk/format.js` — модуль без побочных эффектов в
импортах; тестируйте именно его (см. `test/vk/format.test.js`). У `src/config.js` похожая
проблема в миниатюре: он вызывает `process.exit(1)` уже на этапе `require()`, если не хватает
переменной окружения, поэтому `test/config.test.js` проверяет его через
`child_process.spawnSync` в изолированном процессе, а не через прямой `require()` в тестовом
процессе.

### Известная открытая проблема: `node-telegram-bot-api@0.66.0`

`npm audit` показывает critical-уязвимость (небезопасная случайность / CRLF-инъекция в
`form-data`) через устаревшую транзитивную зависимость `request` этого пакета. Исправление — это
релиз `1.x`, полный рероут на TypeScript с другим API — не накатывайте его бездумно. Любой апгрейд
требует осознанного тестирования `bot.onText`, `bot.sendMessage`, `bot.editMessageText` и поведения
поллинга на реальном токене бота перед мёрджем. В CI `npm audit` запускается как
неблокирующий, информационный шаг (`continue-on-error: true` в `.github/workflows/ci.yml`) именно
по этой причине.
