-- Owners' dashboard (#/admin): page views recorded by the site, read only through admin_stats().
--
-- Make an account an admin (run once in the SQL editor, with that account's email):
--   insert into public.admins (user_id) select id from auth.users where lower(email) = 'owner@example.com' on conflict do nothing;

-- Visits: one row per page view, with an anonymous visitor id kept in the browser (no IP, no cookies).
create table if not exists public.page_views (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  visitor text not null check (char_length(visitor) between 8 and 40),
  session text check (char_length(session) <= 40),
  path text not null check (char_length(path) <= 120),
  symbol text check (char_length(symbol) <= 30),
  ref text check (char_length(ref) <= 120),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  app boolean not null default false,
  user_id uuid references auth.users on delete set null
);
create index if not exists page_views_at on public.page_views (at);
alter table public.page_views enable row level security;
drop policy if exists "record a page view" on public.page_views;
create policy "record a page view" on public.page_views for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
-- nobody can read page views directly; only admin_stats() below

-- Who may see the dashboard
create table if not exists public.admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.admin_stats(days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 365)));
  r jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'generated', now(),
    'days', days,
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new', (select count(*) from auth.users where created_at >= since),
      'active', (select count(*) from auth.users where last_sign_in_at >= since),
      'confirmed', (select count(*) from auth.users where email_confirmed_at is not null)),
    'pro', (select count(*) from public.profiles where plan = 'pro' and (pro_until is null or pro_until > now())),
    'revenue', (select coalesce(sum(amount), 0) from public.payments where status = 'paid' and paid_at >= since),
    'payments', (select count(*) from public.payments where status = 'paid' and paid_at >= since),
    'alerts', (select count(*) from public.alerts where active),
    'watchlists', (select count(*) from public.user_data where key = 'watchlist'),
    'views', (select count(*) from public.page_views where at >= since),
    'visitors', (select count(distinct visitor) from public.page_views where at >= since),
    'sessions', (select count(distinct session) from public.page_views where at >= since),
    'app_visitors', (select count(distinct visitor) from public.page_views where at >= since and app),
    'today', jsonb_build_object(
      'views', (select count(*) from public.page_views where at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
      'visitors', (select count(distinct visitor) from public.page_views where at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')),
    'daily', (select coalesce(jsonb_agg(x order by x->>'day'), '[]'::jsonb) from (
      select jsonb_build_object('day', to_char(date_trunc('day', at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD'),
                                'views', count(*), 'visitors', count(distinct visitor)) x
      from public.page_views where at >= since group by date_trunc('day', at at time zone 'Asia/Kolkata')) t),
    'signups_daily', (select coalesce(jsonb_agg(x order by x->>'day'), '[]'::jsonb) from (
      select jsonb_build_object('day', to_char(date_trunc('day', created_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD'), 'n', count(*)) x
      from auth.users where created_at >= since group by date_trunc('day', created_at at time zone 'Asia/Kolkata')) t),
    'pages', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('k', path, 'views', count(*), 'visitors', count(distinct visitor)) x
      from public.page_views where at >= since group by path order by count(*) desc limit 12) t),
    'companies', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('k', symbol, 'views', count(*), 'visitors', count(distinct visitor)) x
      from public.page_views where at >= since and symbol is not null group by symbol order by count(*) desc limit 15) t),
    'refs', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('k', ref, 'visitors', count(distinct visitor)) x
      from public.page_views where at >= since and ref is not null group by ref order by count(distinct visitor) desc limit 10) t),
    'devices', (select coalesce(jsonb_object_agg(coalesce(device, 'unknown'), n), '{}'::jsonb) from (
      select device, count(distinct visitor) n from public.page_views where at >= since group by device) t),
    'recent_users', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('email', u.email, 'created', u.created_at, 'last', u.last_sign_in_at, 'confirmed', u.email_confirmed_at is not null,
                                'plan', coalesce(p.plan, 'free')) x
      from auth.users u left join public.profiles p on p.id = u.id order by u.created_at desc limit 25) t)
  ) into r;
  return r;
end $$;

revoke all on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_stats(int) to authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
