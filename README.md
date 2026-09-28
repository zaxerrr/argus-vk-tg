# vk-telegram-bot

Пересылка событий VK Callback API в Telegram с логированием и настраиваемыми уведомлениями.

Forwards VK (VKontakte) Callback API webhook events to Telegram as formatted notifications, with
structured logging and runtime-configurable event filtering.

**Language / Язык:** [English](#english) · [Русский](#русский)

---

## English

### What it does

- Receives VK Callback API events on `POST /webhook` (secret-checked, rate-limited).
- Deduplicates repeated deliveries — VK often sends the same event 2-5 times within seconds. Two
  tiers: an in-memory cache, then a Firestore `dedup_seen` collection that survives restarts.
- Formats a short HTML notification per event type (posts, comments, likes with live counters,
  message reactions, group joins/leaves, market orders, etc.) and sends it to Telegram via
  long-polling.
- Telegram bot commands (`/status`, `/toggle_event`, `/set_topic`, `/stats`, `/raw_event`, ...)
  to inspect and control the bot at runtime; admin-only commands are gated by Telegram user ID.
  Commands appear in Telegram's `/` menu and reply in the forum topic they were sent from.
- Routes notifications by role (main/lead/debug/stats) to separate chats or to topics of one
  Telegram supergroup with Forum Topics enabled.
- Logs incoming and outgoing traffic to Firestore; `/stats` shows today's activity per event type.

More detail: [`CLAUDE.md`](./CLAUDE.md) (request flow, code layout),
[`docs/VK_API.md`](./docs/VK_API.md) (API version, confirmation, access tokens, event map),
[`docs/RENDER.md`](./docs/RENDER.md) (Render free tier: sleep, deploys, health checks, keep-alive),
[`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md) (Firebase project setup).

### Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (comments explain each value). Everything under
   "Обязательные / Required" is mandatory — the process exits with code 1 on boot if any is
   missing (`src/config.js`).
3. Firebase (free Spark plan is enough) — see [`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md):
   create a project, enable Firestore (Native mode), put the service-account key JSON into
   `FIREBASE_SERVICE_ACCOUNT`, and check `FIREBASE_FIRESTORE_DATABASE_ID`. No migrations.
4. **`VK_SERVICE_KEY` must be an app *service key* (recommended, never expires) or a user token —
   not a community access key.** VK blocks `likes.*` for community keys (error 27), so like
   counters silently won't work with one. New user tokens via `oauth.vk.com` implicit flow are no
   longer issued (disabled since June 2024). How to get a service key: [`docs/VK_API.md`](./docs/VK_API.md).
5. VK community → Manage → API usage → Callback API: server URL `https://<your-host>/webhook`, the
   secret key = `VK_SECRET_KEY` (a string you make up), copy the confirmation string into
   `VK_CONFIRMATION_CODE`, and **tick the event types** you want on the "Event types" tab —
   confirmation alone doesn't subscribe to anything.
6. `npm start`. The startup message (debug role) checks `likes.getList` with the key and reports
   `VK_SERVICE_KEY: ✅ OK, счётчики лайков работают`, a ⚠️ warning (e.g. error 27) or the VK error.

### Deploying

[`render.yaml`](./render.yaml) is a [Render](https://render.com) Blueprint (free tier): Render
dashboard → New → Blueprint → pick this repo, then fill in the prompted env vars. The free plan
sleeps after 15 minutes without **inbound** traffic; Telegram long-polling is outbound, so while
asleep the bot doesn't answer commands. Wake-up takes ~1 minute, and there are 750 free hours per
month per workspace. See [`docs/RENDER.md`](./docs/RENDER.md) for the consequences and a
keep-alive setup. After changing an env var on Render, **deploy** — a restart doesn't pick up
changes. Node.js is pinned to 22.x (`engines`); any Node 22 host that runs `npm start` and passes
its own `PORT` works.

### Telegram commands

| Command | Access | What it does |
|---|---|---|
| `/help`, `/start` | all | List commands |
| `/status`, `/ping`, `/version` | all | Liveness, latency, version + uptime |
| `/my_chat_id`, `/whoami`, `/topic_id` | all | Chat ID, your user ID/admin flag, current topic's thread ID |
| `/topics` | admin | Resolved chat + topic per role |
| `/set_topic <role> <id\|here\|off>` | admin | Bind a forum topic to a role (`here` = the topic you're in) |
| `/list_events`, `/toggle_event <type>` | admin | Show / switch VK event types on and off |
| `/set_main_chat <id>`, `/send_main <text>` | admin | Change main chat / post into it |
| `/test_notification` | admin | Test message to the debug chat |
| `/stats` | admin | Today's (UTC) activity by event type |
| `/raw_event [type]` | admin | Raw JSON of the latest VK event from `bot_logs` (for unknown types) |

Commands work both as `/help` and as `/help@YourBot` (what Telegram inserts from the `/` menu in
groups); commands addressed to other bots are ignored.

### Forum topics

Each role (`main`/`lead`/`debug`/`stats`) goes to its own `*_CHAT_ID` if set, otherwise into a
topic of the main chat if one is bound, otherwise it's disabled. To use one supergroup: leave
`LEAD_CHAT_ID`/`DEBUG_CHAT_ID`/`STATS_CHAT_ID` empty and run `/set_topic <role> here` inside each
topic. A topic ID only exists inside its own chat — never bind a topic to a role that has a
dedicated `*_CHAT_ID` pointing at another chat (private chats have no topics at all). Details in
`CLAUDE.md`.

### Statistics

`/stats` lists only what happened today (UTC calendar day), e.g. "Лайки: 5", "Сообщения: 10";
zero lines are omitted. VK events are counted after the secret check and deduplication, so VK's
repeated deliveries aren't double-counted. Set `STATS_DIGEST_HOURS` to post it automatically to the
`stats` role.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Like notifications without "(Всего: N)" | `VK_SERVICE_KEY` is a community key — use an app service key; the startup message says so |
| Commands answered minutes late, or in bursts | The Render free instance was asleep — see `docs/RENDER.md` (keep-alive) |
| `retry=N` in `VK запрос` log lines | VK re-delivered because the instance was waking up; duplicates are dropped by `event_id` |
| Startup ⚠️ "Пришло событие VK от сообщества …" | Events from a group other than `VK_GROUP_ID` — they're skipped |
| No startup message, `message thread not found` in logs | A topic is bound to a role whose chat doesn't have it (e.g. a private chat) — `/set_topic <role> off` |
| Render logs show nothing when things happen in VK | Event types not ticked in the community's Callback API settings |
| `VK secret не совпал — запрос отклонён (403)` in logs | `VK_SECRET_KEY` differs from the Callback API secret |
| `409 Conflict` warning | Two bot instances on one token; for 1–2 min after a Render deploy it's expected (old instance gets SIGTERM 60 s after the new one is up) |
| Event shown as `❓ <type>` | New VK event type — grab its payload with `/raw_event <type>` and add a handler |

### Health check

`GET /health` always returns 200 with `{ ok, uptime_sec, ts, firestore }`; `firestore` is a
2s-timeout read of `bot_logs`, cached for 60 s (Render polls the health check every few seconds).

### Known limitations

- Long-polling means **one instance per bot token**.
- `handlers/`, `utils/index.js`, `src/lib/events.js`, `src/storage/*` are unwired legacy code;
  `src/worker.js` / `wrangler.jsonc` are an unfinished Cloudflare Worker stub. See `CLAUDE.md`.
- `/stats` is a calendar-day counter (resets at UTC midnight), not a rolling 24h window.
- A like on a clip published inside a post arrives from VK twice (clip + post); only the first
  one is sent. Clip counters are requested as `video` (clips are videos in VK) — not yet verified
  against a real key.
- While the Render free instance sleeps, commands aren't processed (see `docs/RENDER.md`).
- `npm audit` still reports advisories that come only through `node-telegram-bot-api@0.66`
  (`request`, `form-data`) and through `firebase-admin`'s unused Storage client (`gaxios`/`uuid`).
  The first needs a major, API-breaking upgrade tested against a real bot (see `CLAUDE.md`).
- Likes on photo/video/discussion/market comments get no link: VK doesn't send the parent object's ID.

### Tests

`npm test` — unit tests, offline. `npm run test:integration` — the same code against the Firestore
emulator (needs Java 21); CI runs both.

---

## Русский

### Что делает

- Принимает события VK Callback API на `POST /webhook` (с проверкой секрета и rate limit).
- Отбрасывает повторные доставки — VK часто присылает одно и то же событие 2-5 раз за секунды.
  Дедуп двухуровневый: кэш в памяти, затем коллекция Firestore `dedup_seen`, переживающая рестарт.
- Формирует короткое HTML-уведомление под каждый тип события (посты, комментарии, лайки со
  счётчиком, реакции на сообщения, вступления/выходы, заказы в маркете и т.д.) и отправляет его в
  Telegram через long-polling.
- Команды бота (`/status`, `/toggle_event`, `/set_topic`, `/stats`, `/raw_event` и др.) для
  просмотра и управления в рантайме; админ-команды защищены проверкой Telegram user ID. Команды
  видны в меню `/` и отвечают в той же теме форума, где их вызвали.
- Маршрутизирует уведомления по ролям (main/lead/debug/stats) — в отдельные чаты или в темы одной
  супергруппы с включёнными темами.
- Пишет входящий и исходящий трафик в Firestore; `/stats` показывает активность за сегодня по
  типам событий.

Подробнее: [`CLAUDE.md`](./CLAUDE.md) (поток запроса, структура кода),
[`docs/VK_API.md`](./docs/VK_API.md) (версия API, подтверждение, токены доступа, карта событий),
[`docs/RENDER.md`](./docs/RENDER.md) (бесплатный Render: сон, деплой, health checks, keep-alive),
[`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md) (настройка Firebase).

### Установка

1. `npm install`
2. Скопируйте `.env.example` в `.env` и заполните (комментарии объясняют каждое значение). Всё из
   раздела «Обязательные» строго обязательно — без любой из переменных процесс завершится с кодом
   1 при старте (`src/config.js`).
3. Firebase (хватает бесплатного Spark) — см. [`docs/FIREBASE_SETUP.md`](./docs/FIREBASE_SETUP.md):
   создать проект, включить Firestore (Native mode), вставить JSON ключа сервисного аккаунта в
   `FIREBASE_SERVICE_ACCOUNT`, проверить `FIREBASE_FIRESTORE_DATABASE_ID`. Миграций нет.
4. **`VK_SERVICE_KEY` — сервисный ключ приложения (рекомендуется, бессрочный) или
   пользовательский токен, но не ключ доступа сообщества.** VK не пускает ключи сообщества к
   методам `likes.*` (ошибка 27), и счётчики лайков с таким ключом молча не работают. Новые
   пользовательские токены через `oauth.vk.com` (Implicit Flow) VK больше не выдаёт — отключено с
   июня 2024. Как получить сервисный ключ — [`docs/VK_API.md`](./docs/VK_API.md).
5. Сообщество VK → Управление → Работа с API → Callback API: адрес `https://<ваш-хост>/webhook`,
   секретный ключ = `VK_SECRET_KEY` (строка, которую придумываете сами), строку подтверждения —
   в `VK_CONFIRMATION_CODE`, и **отметьте нужные типы событий** на вкладке «Типы событий» —
   одно подтверждение ни на что не подписывает.
6. `npm start`. Стартовое сообщение (роль debug) проверяет ключом `likes.getList` и покажет
   `VK_SERVICE_KEY: ✅ OK, счётчики лайков работают`, предупреждение ⚠️ (например, ошибка 27) или
   ошибку VK.

### Деплой

[`render.yaml`](./render.yaml) — Blueprint для [Render](https://render.com) (бесплатный тариф):
дашборд Render → New → Blueprint → выбрать репозиторий, заполнить запрошенные переменные. На
бесплатном тарифе сервис засыпает через 15 минут без **входящего** трафика. Long-polling Telegram —
исходящий трафик, поэтому пока сервис спит, бот не отвечает на команды. Пробуждение занимает около
минуты, бесплатных часов — 750 в месяц на весь workspace. Последствия и настройка keep-alive —
в [`docs/RENDER.md`](./docs/RENDER.md). После смены переменной в Render нужен **деплой**: рестарт
изменения не подхватывает. Node.js закреплён на 22.x (`engines`); подойдёт любой хостинг с Node 22,
который запускает `npm start` и передаёт свой `PORT`.

### Команды Telegram

| Команда | Доступ | Что делает |
|---|---|---|
| `/help`, `/start` | все | Список команд |
| `/status`, `/ping`, `/version` | все | Жив ли бот, задержка, версия и аптайм |
| `/my_chat_id`, `/whoami`, `/topic_id` | все | ID чата, твой ID и признак админа, ID текущей темы |
| `/topics` | админ | Итоговый чат + тема по каждой роли |
| `/set_topic <роль> <id\|here\|off>` | админ | Привязать тему к роли (`here` — тема, где пишешь) |
| `/list_events`, `/toggle_event <тип>` | админ | Показать / включить-выключить типы событий VK |
| `/set_main_chat <id>`, `/send_main <текст>` | админ | Сменить основной чат / написать в него |
| `/test_notification` | админ | Тестовое сообщение в debug |
| `/stats` | админ | Активность за сегодня (UTC) по типам событий |
| `/raw_event [тип]` | админ | Сырой JSON последнего VK-события из `bot_logs` (для незнакомых типов) |

Команды работают и как `/help`, и как `/help@ИмяБота` — в группах Telegram так подставляет команду
из меню `/`. Команды, адресованные другим ботам, игнорируются.

### Темы форума

Роль (`main`/`lead`/`debug`/`stats`) идёт в свой `*_CHAT_ID`, если он задан, иначе — в тему
основного чата, если она привязана, иначе роль отключена. Для одной супергруппы: оставьте
`LEAD_CHAT_ID`/`DEBUG_CHAT_ID`/`STATS_CHAT_ID` пустыми и выполните `/set_topic <роль> here` внутри
каждой темы. ID темы существует только внутри своего чата — не привязывайте тему к роли, у которой
задан отдельный `*_CHAT_ID` на другой чат (в личных чатах тем нет вовсе). Подробности в
`CLAUDE.md`.

### Статистика

`/stats` показывает только то, что реально было сегодня (календарные сутки UTC), например
«Лайки: 5», «Сообщения: 10»; нулевые строки не выводятся. События VK считаются после проверки
секрета и дедупа, поэтому повторные доставки VK не завышают цифры. `STATS_DIGEST_HOURS` включает
автоматическую отправку в роль `stats`.

### Диагностика

| Симптом | Вероятная причина |
|---|---|
| Уведомления о лайках без «(Всего: N)» | В `VK_SERVICE_KEY` ключ сообщества — нужен сервисный ключ приложения; стартовое сообщение это покажет |
| Команды отвечают с опозданием на минуты или пачкой | Инстанс Render free спал — см. `docs/RENDER.md` (keep-alive) |
| В логах `VK запрос: … retry=N` | VK повторил доставку, пока инстанс просыпался; дубли отсекаются по `event_id` |
| ⚠️ «Пришло событие VK от сообщества …» | События от группы, отличной от `VK_GROUP_ID`, — они пропускаются |
| Нет стартового сообщения, в логах `message thread not found` | К роли привязана тема, которой нет в её чате (например, в личке) — `/set_topic <роль> off` |
| В VK события есть, а в логах Render пусто | Не отмечены типы событий в настройках Callback API сообщества |
| В логах `VK secret не совпал — запрос отклонён (403)` | `VK_SECRET_KEY` не совпадает с секретом Callback API |
| Предупреждение `409 Conflict` | Два инстанса на одном токене; 1–2 мин после деплоя на Render — норма (старый инстанс гасится через 60 с после старта нового) |
| Событие пришло как `❓ <тип>` | Новый тип события VK — достаньте payload через `/raw_event <тип>` и добавьте обработчик |

### Health-check

`GET /health` всегда отвечает 200 и `{ ok, uptime_sec, ts, firestore }`; `firestore` — чтение из
`bot_logs` с таймаутом 2 с, результат кэшируется на 60 с (Render дёргает health check каждые
несколько секунд).

### Известные ограничения

- Long-polling — **один инстанс на токен бота**.
- `handlers/`, `utils/index.js`, `src/lib/events.js`, `src/storage/*` — неподключённый старый код;
  `src/worker.js` / `wrangler.jsonc` — незавершённая заготовка Cloudflare Worker. См. `CLAUDE.md`.
- `/stats` — счётчик за календарные сутки (обнуляется в полночь UTC), а не скользящее окно 24ч.
- Лайк клипа, опубликованного в посте, VK присылает дважды (клип + пост) — в чат уходит только
  первое. Счётчик для клипа запрашивается как для `video` (клип в VK — видеозапись); на реальном
  ключе ещё не проверено.
- Пока инстанс Render free спит, команды не обрабатываются (см. `docs/RENDER.md`).
- `npm audit` всё ещё показывает уязвимости, пришедшие только через `node-telegram-bot-api@0.66`
  (`request`, `form-data`) и через неиспользуемый клиент Storage в `firebase-admin` (`gaxios`/`uuid`).
  Для первых нужен мажорный апгрейд с другим API и проверкой на реальном боте (см. `CLAUDE.md`).
- У лайков комментариев к фото/видео/обсуждениям/товарам нет ссылки: VK не присылает ID родителя.

### Тесты

`npm test` — юнит-тесты, без сети. `npm run test:integration` — тот же код против эмулятора
Firestore (нужна Java 21); в CI гоняются оба.
