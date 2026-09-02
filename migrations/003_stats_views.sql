-- migrations/003_stats_views.sql
-- SQL-вьюхи статистики поверх bot_logs (см. src/lib/logger.js) — используются командой
-- /stats и опциональным автодайджестом (STATS_DIGEST_HOURS, см. src/lib/stats.js), а также
-- пригодны для произвольной аналитики прямо в Supabase SQL Editor или во внешнем BI
-- (например, Metabase поверх той же базы).
--
-- Применить после 001_bot_state.sql: Supabase SQL Editor -> вставить и выполнить (один раз).
-- create or replace view — безопасно перезапускать повторно при обновлении определений.

-- Скользящее окно 24 часа — то, что показывает бот в /stats и в периодической сводке.
create or replace view bot_stats_overview_24h as
select
  count(*) filter (where source = 'vk' and event = 'incoming_update')        as vk_events_24h,
  count(*) filter (where source = 'telegram' and event = 'incoming_update') as telegram_updates_24h,
  count(*) filter (where source = 'telegram' and event = 'outgoing_message') as telegram_sent_24h,
  count(*) filter (where level = 'error')                                   as errors_24h
from bot_logs
where ts >= now() - interval '24 hours';

-- Разбивка событий VK по типу за последние 24 часа (тип события лежит в payload->>'type' —
-- см. logMiddlewareVK() в src/lib/logger.js).
create or replace view bot_stats_vk_events_last_24h as
select
  payload->>'type' as vk_event_type,
  count(*) as events
from bot_logs
where source = 'vk' and event = 'incoming_update'
  and ts >= now() - interval '24 hours'
  and payload ? 'type'
group by 1
order by 2 desc;

-- Дневные тренды по типам событий VK — для ad-hoc-анализа за произвольный период
-- (не используется ботом напрямую, только для ручных запросов/BI).
create or replace view bot_stats_vk_events_daily as
select
  date_trunc('day', ts) as day,
  payload->>'type' as vk_event_type,
  count(*) as events
from bot_logs
where source = 'vk' and event = 'incoming_update' and payload ? 'type'
group by 1, 2
order by 1 desc, 3 desc;

-- Дневные тренды по ошибкам, с разбивкой по источнику (vk/telegram/http/state/...).
create or replace view bot_stats_errors_daily as
select
  date_trunc('day', ts) as day,
  source,
  count(*) as errors
from bot_logs
where level = 'error'
group by 1, 2
order by 1 desc, 3 desc;
