-- migrations/002_forum_topics.sql
-- Персистентность message_thread_id (тем форум-супергруппы) по ролям уведомлений
-- (main/lead/debug/stats) — см. src/state.js (state.topics) и src/telegram.js
-- (resolveRoleTarget). Позволяет держать все уведомления в одной супергруппе Telegram
-- вместо нескольких отдельных чатов, разделяя их по темам.
--
-- Применить после 001_bot_state.sql: Supabase SQL Editor -> вставить и выполнить (один раз).

alter table bot_state
  add column if not exists topics jsonb not null default '{}'::jsonb;
