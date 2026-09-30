-- Delivery result of each alert (supabase/functions/dispatch-alerts): the channels it actually went out on,
-- and a short note when a chosen channel could not be used (not switched on yet, not connected, failed).
alter table public.alert_log add column if not exists delivered text[];
alter table public.alert_log add column if not exists note text;
