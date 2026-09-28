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
- `npm run test:integration` — `test/integration/` against the Firestore emulator (needs Java 21;
  `firebase.json` in the repo root is only the emulator config). Also runs in CI as a separate job.
  Without `FIRESTORE_EMULATOR_HOST` the integration test is skipped, so plain `npm test` stays offline.
- No lint/build step is configured.

#### Required environment variables

`server.js` boots through `src/config.js`, which calls `process.exit(1)` if any of these are
missing: `VK_GROUP_ID`, `VK_SECRET_KEY`, `VK_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `FIREBASE_SERVICE_ACCOUNT` (the full JSON of a Firebase service-account key,
as one string — see `docs/FIREBASE_SETUP.md`). **`VK_SERVICE_KEY` must be an app *service key* (recommended,
never expires) or a user token, not a community access key**: VK blocks the whole `likes.*`
section for community keys (error 27, "method is unavailable with group auth"), so like counters
silently vanish while `users.get` keeps working. New user tokens via the `oauth.vk.com` implicit
flow are no longer issued (disabled June 2024) — see `docs/VK_API.md`. `VK_SECRET_KEY` is not a VK credential at all, just the
Callback API secret string you choose. Optional: `FIREBASE_FIRESTORE_DATABASE_ID`
(defaults to `default` — `src/lib/db.js` always passes a Firestore database ID explicitly rather
than relying on the `getFirestore(app)` default of the special `(default)` database, which this
project's database is *not* named — see the warning in `docs/FIREBASE_SETUP.md`), `LEAD_CHAT_ID`, `DEBUG_CHAT_ID`,
`STATS_CHAT_ID`, `TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID` (forum-topic thread IDs — see
[Forum topics](#forum-topics-single-supergroup) below), `STATS_DIGEST_HOURS`, `ADMIN_USER_IDS`
(comma-separated Telegram user IDs), `BOT_VERSION` (falls back to `package.json` version), `PORT`
(default 3000, but hosting providers that inject their own `PORT` — e.g. Render — take priority).
Optional numeric vars (`STATS_DIGEST_HOURS`, `TELEGRAM_TOPIC_*_ID`) are validated in `src/config.js`:
a non-positive/non-numeric value is ignored with a warning (`STATS_DIGEST_HOURS=abc` used to become
`setInterval(NaN)`, i.e. a digest every millisecond); `VK_GROUP_ID` with a leading minus is normalized.
See `.env.example` for a filled-in template. No migrations to run: Firestore collections/documents
are created on first write (`docs/FIREBASE_SETUP.md` lists what gets created and by which module).

### Request flow (the live code path)

```
VK Callback API → POST /webhook (server.js) → timing-safe secret check (VK_SECRET_KEY, crypto.timingSafeEqual; only failed checks go through the rate limiter in src/security/rateLimit.js and get 403/429) → logIncomingVK (bot_logs) → confirmation / noise ack → group_id must equal VK_GROUP_ID (else ack "ok" and skip) → respond "ok" immediately (VK requires a fast ack or it retries) → src/vk/dedup.js: shouldProcessEvent / rememberEvent (primary key = the request's `event_id`, in-memory 10 min + Firestore `dedup_seen` 24 h; plus a 60 s in-memory content key — see below) → isMirroredLike (clip↔post like pair) → logger.info({source:'vk', event:'processed_event'}) (what `/stats` counts) → src/vk/events.js: handleVkEvent({ type, object }) → checks src/state.js eventToggleState (per-type on/off, runtime-mutable via Telegram commands) → builds a short HTML message (emoji + VK deep link + optional live like counter fetched from VK API) per event type via a big switch statement, using pure link/declension helpers from src/vk/format.js → src/telegram.js: sendToRole('main'|'lead', …) resolves the target chat + optional forum-topic message_thread_id (see below) → sendTelegramMessageWithRetry (3 retries, 1s/2s/3s backoff, failures echoed to the "debug" role and logged via src/lib/logger.js)
```

Telegram → bot commands are registered in `src/commands.js` via `bot.onText`, using the same
long-polling `bot` instance from `src/telegram.js`. Admin-only commands check
`isAdmin()` (`src/state.js`) against `ADMIN_USER_IDS`. Command replies go through the local
`reply(msg, …)` helper, which echoes `msg.message_thread_id` so a command typed inside a forum
topic answers in that topic (plain `sendTelegramMessageWithRetry(msg.chat.id, …)` lands in
General). Don't use `reply()` when the target is a *different* chat (`/send_main`,
`/test_notification` with `DEBUG_CHAT_ID`) — a thread ID only exists inside its own chat. The
command list is also registered with `bot.setMyCommands()` for Telegram's `/` menu — keep it, the
`/help` text and the unknown-command regex in sync when adding a command. Register handlers
through the local `on(re, …)` wrapper with a `(?:@\w+)?` suffix after the command name: in groups
Telegram inserts `/cmd@BotName` from the menu, and `on()` ignores commands addressed to other bots.

VK API calls all go through `vkApi()` in `src/vk/api.js` (domain `api.vk.ru`, key in the
`Authorization: Bearer` header, `v=5.199`, errors returned as `{ error }` — VK reports errors in an
HTTP 200 body). Don't call `axios` against VK directly.

Telegram sending (`src/telegram.js`): `sendTelegramMessageWithRetry()` never throws and returns
`true`/`false`; it doesn't retry 400/403 (permanent: bad HTML, missing topic, bot removed), waits
`retry_after` on 429, and reports a final failure once to the `debug` role — including when
`debug` is a topic of the same chat (compare chat **and** thread, not just chat). Command handlers
registered via `on()` in `src/commands.js` have their rejections caught, and `server.js` installs
a `process.on('unhandledRejection')` logger: Node ≥15 exits on an unhandled rejection, and
`node-telegram-bot-api` doesn't catch errors thrown by `onText` handlers.

Logging: `src/lib/logger.js` batches records into the Firestore `bot_logs` collection. Every
`payload` goes through `toFirestoreSafe()` (`src/lib/firestoreSafe.js`): Firestore rejects nested
arrays (VK `keyboard.buttons`), `undefined` and `__reserved__` keys, and one bad record used to fail
the whole batch commit (up to 50 records lost). Incoming VK
webhooks are logged by `logIncomingVK(req)`, called **after** the secret check so unauthenticated
floods cost no Firestore writes (the `secret` field is stripped — `/raw_event` echoes logged
payloads into Telegram); every record carries an `expireAt` Timestamp (30 days) for a TTL policy, incoming Telegram messages by `logIncomingTelegram()` from
`bot.on('message')` in `src/telegram.js` (the bot long-polls, so there's no Express route for it),
outgoing messages by `logOutgoingMessage()` inside `sendTelegramMessageWithRetry`. `server.js`
also sends a startup message to the `debug` role that includes a `checkVkServiceKey()` result: it
calls `likes.getList` on the latest wall post, so it does tell whether like counters will work.

Dedup keys (`src/vk/dedup.js`): the primary key is the request's top-level `event_id` (VK's
official schema: "Unique event id. If it passed twice or more — you should ignore it"; retries
reuse it). A content key (type + object + actor + date) lives only in memory for 60 s as a
guard against near-simultaneous duplicates with different `event_id`s; when there's no
`event_id`, the content key is the primary key. Content keys used to be primary for 24 h, which
dropped legitimately repeated dateless actions (join → leave → join). The primary key's cache has two tiers: an in-process `NodeCache` (fast, no network round-trip, but reset
on every restart) checked first, and — only on a cache miss — a Firestore lookup/write against the
`dedup_seen` collection (doc ID = the same md5 key), which survives restarts. This two-tier design
exists because relying on in-memory-only dedup turned out not to be safe in practice on Render's
free tier: the service restarts far more often than "rarely" (sleep-after-15-min-inactivity,
redeploys), and if VK retries a delivery (having not received "ok" in time) after one of those
restarts, an in-memory-only cache has already forgotten the event — producing duplicate
notifications. `shouldProcessEvent(ctx, db)`/`rememberEvent(ctx, db)` take the Firestore client as
an explicit parameter (not a top-level `require('../lib/db')`) specifically so `src/vk/dedup.js`
keeps zero side-effecting imports and stays testable in isolation (see Testing conventions below);
omitting `db` (as the unit tests do) falls back to in-memory-only behavior. A failed/unreachable
Firestore check fails open (treats the event as new) rather than blocking real events.
`shouldProcessEvent` claims the in-memory key synchronously *before* its first `await` — VK sends
duplicate deliveries in parallel, and claiming only after the Firestore round-trip let both through.
After dedup, `isMirroredLike()` drops the second half of VK's clip↔post like pair (a like on a clip
embedded in a post arrives as two `like_add`s, clip and post, from the same liker within seconds).
`eventToggleState`, `CURRENT_MAIN_CHAT_ID`, and `topics`, however, are persisted to the Firestore
document `bot_state/main` via
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
log record, keyed off `source`/`event`/`level`. VK events are counted on `processed_event` (logged
by `server.js` after the secret check and dedup), **not** on the raw `incoming_update` — counting
raw deliveries inflated the numbers with VK's repeated deliveries, confirmations and 403s. VK event
types go into a nested `vk_event_types` map (field-path segment sanitized against the untrusted
webhook `type`). Build that update as a nested object (`{ vk_event_types: { [type]: inc } }`), never
as a dotted string key: `set(…, {merge: true})` doesn't split dots (only `update()` does), so a
`"vk_event_types.like_add"` key creates a literal top-level field with a dot in its name — that bug
kept the per-type breakdown empty for a while. `/stats` is a **calendar-day counter reset at UTC
midnight**, not a rolling 24-hour window — deliberate trade-off for minimal Firestore reads/writes
on the free (Spark) tier; no historical/daily-trend queries. `getOverview24h()` /
`getTopVkEventTypes()` read that one document; `formatDigest` is pure and unit-tested
(`test/lib/stats.test.js`): it omits zero lines, prints "Событий не было." when nothing happened,
and labels VK types via `VK_TYPE_LABELS` (raw type as fallback). The `/stats` admin command sends
it on demand; if `STATS_DIGEST_HOURS`
is set, `server.js` also posts it automatically on that interval to the `stats` role (see Forum
topics above) — unset by default, so existing deployments get no new automatic messages unless
explicitly opted in.

### VK API reference

`docs/VK_API.md` is the maintained source of truth for the VK API version/base URL in use, access
key types, Callback API confirmation/retry rules, and — most importantly — a table cross-checking
every VK event type against its `state.eventToggleState` key and `handleVkEvent()` switch `case`
and the official event list. **Update that file in the same change** whenever you touch VK event
handling (`src/vk/events.js`, `src/vk/api.js`, `src/state.js`, `src/utils.js`,
`src/vk/format.js`) — it's what catches the toggle/case drift described below before it ships.
It lists its sources: dev.vk.com pages are an SPA but serve their text in HTML (fetch with
`curl -A "Mozilla/5.0"` and strip tags), and the official JSON schema lives in
`github.com/VKCOM/vk-api-schema` (`callback/objects.json`) — check field names there instead of
guessing (the `message_reaction_event` handler once read a non-existent `reactor_id`).

`docs/RENDER.md` is the same for the Render free tier: sleep after 15 min without inbound traffic
(Telegram long-polling doesn't count), 750 h/month per workspace, zero-downtime deploys (old
instance keeps polling for 60 s → expected 409s), health checks every few seconds (keep `/health`
cheap and always 200), env var changes need a deploy, Node pinned via `engines`.

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
5. Add a Russian label to `VK_TYPE_LABELS` in `src/lib/stats.js` (used by `/stats`).
6. If the event's `object` has no `id`/`date` and uses new field names, check that
   `buildKey()` in `src/vk/dedup.js` picks up its object and actor IDs — otherwise distinct events
   collapse into one dedup key and all but the first are dropped (happened with `like_add`).
7. Add the row to the table in `docs/VK_API.md`. To see a real payload of an unknown type, use
   `/raw_event <type>` in the bot.

### Testing conventions

Tests use Node's built-in `node:test` + `node:assert/strict` (see `test/vk/dedup.test.js`), not
Jest/Mocha. Anything about what Firestore will actually accept (value types, merges, queries)
belongs in `test/integration/firestore.test.js` — the fake `db` objects in unit tests accept
anything, which is how the nested-array batch failure went unnoticed. Place new tests under `test/`, mirroring the `src/` path being tested.

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
- `npm run test:integration` — `test/integration/` против эмулятора Firestore (нужна Java 21;
  `firebase.json` в корне — только конфиг эмулятора). В CI — отдельная задача. Без
  `FIRESTORE_EMULATOR_HOST` интеграционный тест пропускается, обычный `npm test` работает офлайн.
- Шаг линтинга/сборки не настроен.

#### Обязательные переменные окружения

`server.js` запускается через `src/config.js`, который вызывает `process.exit(1)`, если
отсутствует хотя бы одна из переменных: `VK_GROUP_ID`, `VK_SECRET_KEY`, `VK_SERVICE_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `FIREBASE_SERVICE_ACCOUNT` (весь JSON сервисного
аккаунта Firebase одной строкой — см. `docs/FIREBASE_SETUP.md`). **`VK_SERVICE_KEY` — сервисный ключ
приложения (рекомендуется, бессрочный) или пользовательский токен, но не ключ доступа
сообщества**: VK закрывает для ключей сообщества весь раздел `likes.*` (ошибка 27, «method is
unavailable with group auth»), и счётчики лайков молча пропадают, хотя `users.get` работает. Новые
пользовательские токены через Implicit Flow `oauth.vk.com` VK не выдаёт с июня 2024 — см.
`docs/VK_API.md`. `VK_SECRET_KEY` вообще не credential
VK, а придуманная вами строка-секрет Callback API. Необязательные:
`FIREBASE_FIRESTORE_DATABASE_ID` (по умолчанию `default` — `src/lib/db.js` всегда передаёт ID базы
Firestore явно, а не полагается на дефолт `getFirestore(app)`, который ищет специальную базу
`(default)` — а база этого проекта называется иначе, см. предупреждение в
`docs/FIREBASE_SETUP.md`), `LEAD_CHAT_ID`,
`DEBUG_CHAT_ID`, `STATS_CHAT_ID`, `TELEGRAM_TOPIC_{MAIN,LEAD,DEBUG,STATS}_ID` (ID тем форума —
см. [Темы супергруппы](#темы-forum-topics-единая-супергруппа) ниже), `STATS_DIGEST_HOURS`,
`ADMIN_USER_IDS` (ID пользователей Telegram через запятую), `BOT_VERSION` (по умолчанию берётся
версия из `package.json`), `PORT` (по умолчанию 3000, но хостинги со своим `PORT` — например,
Render — имеют приоритет). Необязательные числовые переменные (`STATS_DIGEST_HOURS`,
`TELEGRAM_TOPIC_*_ID`) проверяются в `src/config.js`: не положительное число игнорируется с
предупреждением (`STATS_DIGEST_HOURS=abc` раньше давал `setInterval(NaN)` — дайджест каждую
миллисекунду); минус в `VK_GROUP_ID` убирается. См. `.env.example` для готового шаблона. Миграции запускать не нужно:
коллекции/документы Firestore создаются при первой записи (что и каким модулем создаётся —
`docs/FIREBASE_SETUP.md`).

### Поток обработки запроса (реальный рабочий путь кода)

```
VK Callback API → POST /webhook (server.js) → timing-safe проверка секрета (VK_SECRET_KEY, crypto.timingSafeEqual; через rate limiter из src/security/rateLimit.js проходят только неудачные проверки — 403/429) → logIncomingVK (bot_logs) → confirmation / быстрый ack шумных событий → group_id должен совпадать с VK_GROUP_ID (иначе "ok" и пропуск) → немедленный ответ "ok" (VK требует быстрого подтверждения, иначе повторяет запрос) → src/vk/dedup.js: shouldProcessEvent / rememberEvent (основной ключ — `event_id` запроса: память 10 мин + Firestore `dedup_seen` сутки; плюс контентный ключ в памяти на 60 с, см. ниже) → isMirroredLike (пара лайков клип↔пост) → logger.info({source:'vk', event:'processed_event'}) (именно это считает `/stats`) → src/vk/events.js: handleVkEvent({ type, object }) → проверка src/state.js eventToggleState (вкл/выкл по типу события, изменяется в рантайме через команды Telegram) → формирование короткого HTML-сообщения (эмодзи + прямая ссылка VK + опциональный актуальный счётчик лайков из VK API) для каждого типа события через большой switch, с использованием чистых хелперов ссылок/склонений из src/vk/format.js → src/telegram.js: sendToRole('main'|'lead', …) определяет целевой чат + опциональный message_thread_id темы форума (см. ниже) → sendTelegramMessageWithRetry (3 попытки, задержки 1с/2с/3с, ошибки дублируются в роль "debug" и логируются через src/lib/logger.js)
```

Команды Telegram → бот регистрируются в `src/commands.js` через `bot.onText`, используя тот же
экземпляр `bot` (long-polling) из `src/telegram.js`. Команды только для администратора проверяют
`isAdmin()` (`src/state.js`) по списку `ADMIN_USER_IDS`. Ответы команд идут через локальный
хелпер `reply(msg, …)`, который возвращает `msg.message_thread_id` — команда, набранная в теме
форума, отвечает в эту же тему (голый `sendTelegramMessageWithRetry(msg.chat.id, …)` уходит в
General). Не используйте `reply()`, если отправка идёт в *другой* чат (`/send_main`,
`/test_notification` с `DEBUG_CHAT_ID`) — ID темы существует только внутри своего чата. Список
команд также регистрируется через `bot.setMyCommands()` для меню `/` в Telegram — при добавлении
команды держите в синхроне его, текст `/help` и регулярку неизвестных команд. Обработчики
регистрируйте через локальную обёртку `on(re, …)` с суффиксом `(?:@\w+)?` после имени команды: в
группах Telegram подставляет из меню `/cmd@ИмяБота`, а `on()` игнорирует команды другим ботам.

Все вызовы VK API — через `vkApi()` из `src/vk/api.js` (домен `api.vk.ru`, ключ в заголовке
`Authorization: Bearer`, `v=5.199`, ошибки возвращаются как `{ error }` — VK отдаёт их в теле с
HTTP 200). Не вызывайте VK через `axios` напрямую.

Отправка в Telegram (`src/telegram.js`): `sendTelegramMessageWithRetry()` не бросает исключений и
возвращает `true`/`false`; не повторяет 400/403 (постоянные ошибки: битый HTML, нет темы, бота
удалили), на 429 ждёт `retry_after` и один раз сообщает об окончательном сбое в роль `debug` — в том
числе когда `debug` — тема того же чата (сравниваются чат **и** тема, а не только чат). Ошибки
обработчиков, зарегистрированных через `on()` в `src/commands.js`, перехватываются, а `server.js`
ставит логирующий `process.on('unhandledRejection')`: Node ≥15 завершает процесс на необработанном
отклонении, а `node-telegram-bot-api` ошибки обработчиков `onText` не ловит.

Логирование: `src/lib/logger.js` пакетно пишет записи в коллекцию Firestore `bot_logs`. Каждый
`payload` проходит через `toFirestoreSafe()` (`src/lib/firestoreSafe.js`): Firestore отвергает
вложенные массивы (VK `keyboard.buttons`), `undefined` и ключи вида `__name__`, и одна такая запись
роняла commit всего пакета (до 50 записей терялись). Входящие
вебхуки VK — `logIncomingVK(req)`, вызывается **после** проверки секрета, чтобы флуд без секрета
не тратил записи Firestore (поле `secret` вырезается: `/raw_event` выводит сохранённые payload в
Telegram); у каждой записи есть Timestamp `expireAt` (30 суток) для TTL-политики, входящие сообщения Telegram — `logIncomingTelegram()` из `bot.on('message')`
в `src/telegram.js` (бот работает через long-polling, Express-маршрута для него нет), исходящие —
`logOutgoingMessage()` внутри `sendTelegramMessageWithRetry`. `server.js` при старте шлёт в роль
`debug` сообщение с результатом `checkVkServiceKey()`: он вызывает `likes.getList` на последнем посте
стены и потому действительно показывает, будут ли работать счётчики лайков.

Ключи дедупа (`src/vk/dedup.js`): основной — `event_id` из запроса (официальная схема VK: «Unique
event id. If it passed twice or more — you should ignore it»; повторы приходят с тем же ID).
Контентный ключ (тип + объект + актёр + дата) живёт только в памяти 60 с — страховка от почти
одновременных дублей с разными `event_id`; без `event_id` основным становится он. Раньше
контентный ключ был основным и жил сутки — и глотал повторные действия без даты (вступил → вышел →
вступил). Хранение основного ключа двухуровневое: сначала быстрый in-memory `NodeCache` (без похода в сеть, но сбрасывается при
каждом рестарте), и только при промахе — проверка/запись в Firestore-коллекцию `dedup_seen`
(document ID = тот же md5-ключ), переживающую рестарт. Второй уровень понадобился, потому что
предположение «in-memory кэша достаточно, дубликаты возможны только в коротком окне повторов VK» на
практике не выдержало: бесплатный тариф Render перезапускает процесс заметно чаще, чем «редко» (сон
после 15 мин простоя, редеплой) — и если VK повторно доставляет событие (не получив вовремя "ok")
уже после такого рестарта, in-memory-кэш о нём ничего не знает, и уведомление задваивается.
`shouldProcessEvent(ctx, db)`/`rememberEvent(ctx, db)` принимают Firestore-клиент явным параметром
(а не через `require('../lib/db')` на верхнем уровне модуля) специально для того, чтобы
`src/vk/dedup.js` оставался без побочных эффектов при импорте и тестировался изолированно (см.
«Соглашения по тестированию» ниже); без `db` (как в юнит-тестах) работает только in-memory уровень.
Недоступность/ошибка Firestore не блокирует обработку реальных событий (fail-open).
`shouldProcessEvent` захватывает ключ в памяти синхронно, *до* первого `await` — VK шлёт повторные
доставки параллельно, и захват после похода в Firestore пропускал обе. После дедупа
`isMirroredLike()` отбрасывает вторую половину пары лайков клип↔пост (лайк клипа, вложенного в
пост, VK присылает двумя `like_add` — на clip и на post — от одного лайкера за секунды). А вот `eventToggleState`,
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
`src/lib/logger.js`, ориентируясь на `source`/`event`/`level`. События VK считаются по
`processed_event` (его пишет `server.js` после проверки секрета и дедупа), **а не** по сырому
`incoming_update` — подсчёт сырых доставок завышал цифры повторными доставками VK, confirmation и
запросами с 403. Типы событий VK попадают во вложенную карту `vk_event_types` (сегмент пути поля
санитизируется против недоверенного `type` из вебхука). Обновление строится вложенным объектом
(`{ vk_event_types: { [type]: inc } }`), а не строковым ключом с точкой: `set(…, {merge: true})`
точки не разбирает (это делает только `update()`), и ключ `"vk_event_types.like_add"` создаёт
отдельное поле с точкой в имени — из-за этого разбивка по типам какое-то время была пустой.
`/stats` — **счётчик за календарные сутки, обнуляемый в полночь UTC**, а не скользящее окно 24ч —
осознанный компромисс ради минимума чтений/записей на бесплатном (Spark) тарифе Firestore;
истории/дневных трендов нет. `getOverview24h()`/`getTopVkEventTypes()` читают этот один документ;
`formatDigest` — чистая функция, покрыта тестом (`test/lib/stats.test.js`): не выводит нулевые
строки, пишет «Событий не было.», если ничего не случилось, и подписывает типы VK через
`VK_TYPE_LABELS` (с фолбэком на сырой тип). Админ-команда `/stats`
шлёт его по запросу; если задан `STATS_DIGEST_HOURS`, `server.js` также публикует его
автоматически с этим интервалом в роль `stats` (см. «Темы» выше) — по умолчанию не задан, так что
у существующих развёртываний новые автоматические сообщения не появляются без явного включения.

### Справочник по VK API

`docs/VK_API.md` — поддерживаемый источник истины по используемой версии VK API/базовому URL,
типам ключей, правилам подтверждения и повторов Callback API и, самое важное, по таблице
соответствия «тип события VK ↔ ключ в `state.eventToggleState` ↔ `case` в `handleVkEvent()` ↔
официальный список». **Обновляйте этот файл в том же изменении**, где трогаете обработку
VK-событий (`src/vk/events.js`, `src/vk/api.js`, `src/state.js`, `src/utils.js`,
`src/vk/format.js`) — именно он ловит рассинхронизацию тумблер/case до того, как она уедет в прод.
В нём перечислены источники: страницы dev.vk.com — SPA, но текст отдают в HTML (`curl -A
"Mozilla/5.0"` и вырезать теги), официальная JSON-схема — `github.com/VKCOM/vk-api-schema`
(`callback/objects.json`). Имена полей сверяйте там, а не угадывайте (обработчик
`message_reaction_event` однажды читал несуществующий `reactor_id`).

`docs/RENDER.md` — то же для бесплатного Render: сон через 15 мин без входящего трафика
(long-polling Telegram не считается), 750 ч/мес на workspace, zero-downtime деплой (старый инстанс
ещё 60 с опрашивает Telegram → ожидаемые 409), health checks каждые несколько секунд (`/health`
должен быть дешёвым и всегда 200), смена переменных требует деплоя, Node закреплён через `engines`.

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
5. Добавьте русскую подпись в `VK_TYPE_LABELS` в `src/lib/stats.js` (используется в `/stats`).
6. Если у `object` события нет `id`/`date` и поля называются по-новому — проверьте, что
   `buildKey()` в `src/vk/dedup.js` подхватывает ID объекта и актёра, иначе разные события
   схлопнутся в один ключ дедупа и дойдёт только первое (так было с `like_add`).
7. Добавьте строку в таблицу `docs/VK_API.md`. Реальный payload незнакомого типа можно получить
   командой `/raw_event <тип>` в боте.

### Соглашения по тестированию

Тесты используют встроенные `node:test` + `node:assert/strict` (см. `test/vk/dedup.test.js`), а не
Jest/Mocha. Всё, что касается того, что Firestore реально примет (типы значений, merge, запросы),
проверяйте в `test/integration/firestore.test.js` — фейковые `db` в юнит-тестах принимают что
угодно, из-за этого и не был замечен отказ пакета логов на вложенных массивах. Новые тесты размещайте в `test/`, повторяя структуру пути в `src/`, который
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
