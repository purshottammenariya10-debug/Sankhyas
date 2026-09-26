-- Sankhyas accounts and Pro payments.
-- profiles: one row per user (created automatically at sign-up). Users can read their own row and
-- change only their name; plan / pro_until are written only by the payment functions.
-- payments: one row per Razorpay order. Users can read their own history.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  pro_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id text not null unique,
  payment_id text unique,
  plan text not null check (plan in ('pro_monthly', 'pro_yearly')),
  amount integer not null,              -- in paise
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.payments enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "read own payments" on public.payments;
create policy "read own payments" on public.payments for select to authenticated using (auth.uid() = user_id);

-- users may only change their display name, never their plan
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;
revoke insert, update, delete on public.payments from authenticated, anon;

-- create the profile row when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- mark an order paid and extend Pro; safe to call twice (browser callback and webhook)
create or replace function public.activate_pro(p_order_id text, p_payment_id text, p_amount integer)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  pay public.payments%rowtype;
  until timestamptz;
begin
  select * into pay from public.payments where order_id = p_order_id for update;
  if not found then
    raise exception 'unknown order %', p_order_id;
  end if;
  if p_amount is not null and p_amount <> pay.amount then
    raise exception 'amount mismatch for order %', p_order_id;
  end if;
  if pay.status = 'paid' then
    select pro_until into until from public.profiles where id = pay.user_id;
    return until;
  end if;
  update public.payments set status = 'paid', payment_id = p_payment_id, paid_at = now() where id = pay.id;
  update public.profiles
     set plan = 'pro',
         pro_until = greatest(now(), coalesce(pro_until, now())) + case when pay.plan = 'pro_yearly' then interval '365 days' else interval '30 days' end
   where id = pay.user_id
  returning pro_until into until;
  return until;
end $$;
revoke all on function public.activate_pro(text, text, integer) from public, anon, authenticated;
