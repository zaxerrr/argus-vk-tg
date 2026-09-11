# VK API — актуальное состояние

> Этот файл — единый источник истины по тому, какую версию VK API и какие события
> Callback API использует бот. **Обновляйте его в том же PR/коммите**, где меняете
> `src/vk/events.js`, `src/state.js`, `src/utils.js` или `src/vk/format.js` в части,
> касающейся VK. Список типов событий в `state.eventToggleState` и `case` в
> `handleVkEvent()` должны быть синхронизированы — расхождения ищите через таблицу ниже.

**Последняя проверка по официальным источникам:** 2026-09-02.

## Версия API и базовый URL

- Используемая версия методов: **`v=5.199`** (актуальная на момент проверки — см.
  [dev.vk.ru/reference/versions](https://dev.vk.ru/reference/versions)). Указывается в
  каждом запросе к `api.vk.com/method/...` (`src/utils.js`, `src/vk/events.js`).
- Базовый URL методов API — по-прежнему **`https://api.vk.com/method/...`**. Домен
  `vk.ru` затрагивает в первую очередь сайт/авторизацию, на REST-эндпоинт методов на
  момент проверки не влияет. Если в будущем VK объявит миграцию `api.vk.com` →
  `api.vk.ru`, это единственное место, которое нужно поменять в двух файлах
  (`src/utils.js`, `src/vk/events.js`).
- Раньше `src/utils.js` (`users.get`) был жёстко закреплён на `v=5.131`, а
  `src/vk/events.js` (`likes.getList`) — на `v=5.199`. Разные версии в одном проекте не
  ломают работу (VK держит обратную совместимость per-version), но это источник
  путаницы при отладке — приведено к единой `5.199`.

## Callback API: подтверждение сервера

При первом указании URL сервера в настройках сообщества (**Управление → Работа с API →
Callback API**) VK присылает `POST` с `{"type": "confirmation", "group_id": ...}` и
ждёт в ответ **точную строку**, которую сам показывает на этой же странице —
**не `"ok"`**. Это отдельная, специфичная для каждого сообщества строка.

- Реализовано в `server.js`: переменная окружения `VK_CONFIRMATION_CODE` (см.
  `.env.example`). Если не задана — бот отвечает `"ok"` и пишет предупреждение в лог
  (сохраняет обратную совместимость с уже подтверждёнными сообществами, но новое
  сообщество так не подтвердится).
- После однократного подтверждения VK этот запрос больше не присылает, пока вы не
  измените URL сервера заново.

## Ключи доступа

| Переменная | Где взять | Для чего используется в коде |
|---|---|---|
| `VK_SECRET_KEY` | Управление → Работа с API → Callback API → «Секретный ключ» | Проверка подлинности запроса на `/webhook` (`server.js`, timing-safe сравнение) |
| `VK_SERVICE_KEY` | Управление → Работа с API → Ключи доступа → «Создать ключ» | `users.get` (имя профиля, `src/utils.js`) и `likes.getList` (счётчик лайков, `src/vk/events.js`). Оба метода не требуют специальных прав для публичного контента сообщества — общий ключ подходит |
| `VK_GROUP_ID` | Числовой ID сообщества (без минуса) | Ссылки на сообщество, вычисление `owner_id` |

## Карта событий: toggle ↔ switch-case

Единственный надёжный источник актуального списка типов Callback API — чекбоксы на
странице **Управление → Работа с API → Callback API** конкретного сообщества (VK может
включать/выключать типы по своему усмотрению без объявления в публичном changelog).
Ниже — то, что реализовано в коде на 2026-09-02.

| Тип события VK | Ключ в `state.eventToggleState` | `case` в `handleVkEvent()` |
|---|---|---|
| `message_new` | ✅ | ✅ |
| `message_reply` | ✅ | ✅ |
| `message_edit` | ✅ | ✅ |
| `message_allow` | ✅ | ✅ |
| `message_deny` | ✅ | ✅ |
| `message_typing_state` | ✅ (по умолчанию выкл — шум) | ✅ |
| `message_read` | ✅ (по умолчанию выкл — шум) | быстрый ack в `server.js`, не доходит до `handleVkEvent` |
| `message_event` | ✅ | ✅ |
| `message_reaction_event` | ✅ | ✅ |
| `wall_post_new` | ✅ | ✅ |
| `wall_post_edit` | ✅ | ✅ |
| `wall_repost` | ✅ | ✅ |
| `wall_reply_new` / `_edit` / `_delete` / `_restore` | ✅ | ✅ |
| `photo_new` | ✅ | ✅ |
| `photo_comment_new` / `_edit` / `_delete` / `_restore` | ✅ | ✅ |
| `video_new` | ✅ | ✅ |
| `video_comment_new` / `_edit` / `_delete` / `_restore` | ✅ | ✅ |
| `audio_new` | ✅ | ✅ |
| `board_post_new` / `_edit` / `_delete` | ✅ | ✅ |
| `market_order_new` / `_edit` | ✅ | ✅ |
| `market_comment_new` / `_edit` / `_delete` | ✅ | ✅ |
| `poll_vote_new` | ✅ | ✅ |
| `group_join` / `group_leave` | ✅ | ✅ |
| `group_change_photo` / `group_change_settings` / `group_officers_edit` | ✅ | ✅ |
| `user_block` / `user_unblock` | ✅ | ✅ |
| `like_add` / `like_remove` | ✅ | ✅ (+ живой счётчик через `likes.getList`) |
| `lead_forms_new` | ✅ | ✅ |
| `app_payload` | ✅ | ✅ |
| `vkpay_transaction` | ✅ | ✅ |

До 2026-09-02 было расхождение: `message_edit`, `message_event`, `market_order_edit`,
`app_payload`, `vkpay_transaction` имели `case`, но не были в `eventToggleState`
(нельзя было выключить через `/toggle_event`, не показывались в `/list_events`);
`wall_repost` был в `eventToggleState`, но без `case` (падал в дефолтный `❓ wall_repost`);
тумблер шума назывался `typing_status` — несуществующий в VK тип, из-за чего реальный
`message_typing_state` никогда не подавлялся. Всё это исправлено.

## Что не удалось проверить автоматически

Официальная документация VK (`dev.vk.ru`, `vk.com/dev`) в основном рендерится через JS
и недоступна для автоматического скрапинга из этой сессии — часть проверок опирается на
сторонние SDK (Rust/Python/Go) и историческую память модели, а не на live-фетч
официальной страницы со списком событий. Если при подключении нового сообщества в
чекбоксах Callback API увидите тип, которого нет в таблице выше — заведите `case` в
`src/vk/events.js` и ключ в `src/state.js` по инструкции в `CLAUDE.md`
(«Adding a new VK event type» / «Добавление нового типа события VK»), затем допишите
строку в эту таблицу.

`message_reaction_event` (реакция на сообщение сообщества) добавлен 2026-09-11 по репорту
пользователя (`❓ message_reaction_event` в чате — сработал дефолтный кейс). Схема
`object` (`reactor_id`, `message_id`, `peer_id`, `reaction_id`) взята по памяти модели, а не
проверена live-фетчем `dev.vk.ru` (см. оговорку выше) — если при реальном событии текст/поля
разойдутся с ожиданиями, поправьте `case 'message_reaction_event'` в `src/vk/events.js` под
фактический payload (его можно достать командой `/raw_event message_reaction_event` в боте).
