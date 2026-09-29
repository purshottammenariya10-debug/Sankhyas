-- Named watchlists (up to 10 per user, each with its own columns) are synced as one JSON row, key 'watchlists'.
-- The plain 'watchlist' row stays: it holds every followed symbol and the alert sender reads it.
alter table public.user_data drop constraint if exists user_data_key_check;
alter table public.user_data add constraint user_data_key_check
  check (key in ('watchlist', 'watchlists', 'screens', 'notes', 'portfolio', 'cc_extra', 'prefs'));
