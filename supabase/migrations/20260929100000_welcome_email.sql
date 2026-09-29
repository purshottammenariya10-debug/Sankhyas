-- Welcome email (supabase/functions/welcome-email): each new user gets it once.
alter table public.profiles add column if not exists welcome_sent_at timestamptz;

-- New users (email confirmed, joined within 3 days) who have not had the welcome email yet.
-- Only the server (service role) may call this.
create or replace function public.pending_welcomes(uid uuid default null)
returns table (id uuid, email text, name text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text,
         coalesce(nullif(p.full_name, ''), u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))
  from auth.users u join public.profiles p on p.id = u.id
  where p.welcome_sent_at is null and u.email is not null and u.email_confirmed_at is not null
    and u.created_at > now() - interval '3 days'
    and (uid is null or u.id = uid)
  order by u.created_at
  limit 200;
$$;
revoke all on function public.pending_welcomes(uuid) from public, anon, authenticated;
grant execute on function public.pending_welcomes(uuid) to service_role;
