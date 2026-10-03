-- Phone and browser notifications (Web Push) for alerts.
--
-- push_subscriptions: each device a user turned notifications on for (the browser's push endpoint and
-- its encryption keys). Users see and manage only their own; supabase/functions/dispatch-alerts sends
-- to them with the service role.
-- push_config: the site's VAPID key pair, created by supabase/functions/push-key on first use. Readable
-- by the service role only (RLS on, no policies): the private key never leaves the server.

create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  last_ok timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;

drop policy if exists "own push subscriptions: read" on public.push_subscriptions;
create policy "own push subscriptions: read" on public.push_subscriptions for select using (auth.uid() = user_id);
drop policy if exists "own push subscriptions: add" on public.push_subscriptions;
create policy "own push subscriptions: add" on public.push_subscriptions for insert with check (auth.uid() = user_id);
drop policy if exists "own push subscriptions: change" on public.push_subscriptions;
create policy "own push subscriptions: change" on public.push_subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own push subscriptions: remove" on public.push_subscriptions;
create policy "own push subscriptions: remove" on public.push_subscriptions for delete using (auth.uid() = user_id);

create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- alerts can be sent as a notification
alter table public.alerts drop constraint if exists alerts_channels_check;
alter table public.alerts add constraint alerts_channels_check check (channels <@ array['email', 'telegram', 'whatsapp', 'push']::text[]);
