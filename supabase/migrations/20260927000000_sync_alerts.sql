-- Sankhyas: account sync (watchlist, screens, notes, portfolio) and alerts (email / Telegram / WhatsApp).

-- ---------- synced user data: one JSON value per key ----------
create table if not exists public.user_data (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key in ('watchlist', 'screens', 'notes', 'portfolio', 'cc_extra', 'prefs')),
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_data enable row level security;
drop policy if exists "own data read" on public.user_data;
create policy "own data read" on public.user_data for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own data insert" on public.user_data;
create policy "own data insert" on public.user_data for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own data update" on public.user_data;
create policy "own data update" on public.user_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own data delete" on public.user_data;
create policy "own data delete" on public.user_data for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------- alert channels on the profile ----------
alter table public.profiles add column if not exists email_alerts boolean not null default true;
alter table public.profiles add column if not exists telegram_chat_id text;
alter table public.profiles add column if not exists telegram_link_token text unique;
alter table public.profiles add column if not exists whatsapp_number text;
alter table public.profiles add column if not exists whatsapp_opt_in boolean not null default false;
revoke update on public.profiles from authenticated, anon;
grant update (full_name, email_alerts, whatsapp_number, whatsapp_opt_in) on public.profiles to authenticated;

-- a one-time code the user sends to the Sankhyas Telegram bot to link their chat
create or replace function public.create_telegram_link() returns text
language plpgsql security definer set search_path = public as $$
declare t text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.profiles set telegram_link_token = t where id = auth.uid();
  return t;
end $$;
revoke all on function public.create_telegram_link() from public, anon;
grant execute on function public.create_telegram_link() to authenticated;

create or replace function public.unlink_telegram() returns void
language sql security definer set search_path = public as $$
  update public.profiles set telegram_chat_id = null, telegram_link_token = null where id = auth.uid();
$$;
revoke all on function public.unlink_telegram() from public, anon;
grant execute on function public.unlink_telegram() to authenticated;

-- ---------- alert rules ----------
create table if not exists public.alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('results', 'red_flags', 'insider_buy', 'order_win', 'bulk_deal', 'price_above', 'price_below', 'screen', 'concall')),
  symbol text,                         -- company alerts; null for screen alerts
  params jsonb not null default '{}'::jsonb,   -- e.g. {"price": 1500} or {"screen": "name", "query": "..."}
  channels text[] not null default array['email'],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (channels <@ array['email', 'telegram', 'whatsapp']::text[])
);
create index if not exists alerts_user_idx on public.alerts (user_id);
create index if not exists alerts_symbol_idx on public.alerts (symbol) where active;
alter table public.alerts enable row level security;
drop policy if exists "own alerts read" on public.alerts;
create policy "own alerts read" on public.alerts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own alerts insert" on public.alerts;
create policy "own alerts insert" on public.alerts for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own alerts update" on public.alerts;
create policy "own alerts update" on public.alerts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own alerts delete" on public.alerts;
create policy "own alerts delete" on public.alerts for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------- delivery log (dedupe) and dispatcher state: written only by the service role ----------
create table if not exists public.alert_log (
  id bigint generated always as identity primary key,
  alert_id bigint not null references public.alerts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_key text not null,
  message text not null,
  channels text[] not null default '{}',
  sent_at timestamptz not null default now(),
  unique (alert_id, event_key)
);
create index if not exists alert_log_user_idx on public.alert_log (user_id, sent_at desc);
alter table public.alert_log enable row level security;
drop policy if exists "own alert log" on public.alert_log;
create policy "own alert log" on public.alert_log for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.dispatch_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.dispatch_state enable row level security;   -- no policies: service role only

revoke insert, update, delete on public.alert_log, public.dispatch_state from authenticated, anon;
revoke select on public.dispatch_state from authenticated, anon;
