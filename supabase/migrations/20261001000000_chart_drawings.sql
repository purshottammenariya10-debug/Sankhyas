-- Chart lines drawn on each company's price chart ({SYMBOL: [...]}) are synced as one row, key 'drawings'.
alter table public.user_data drop constraint if exists user_data_key_check;
alter table public.user_data add constraint user_data_key_check
  check (key in ('watchlist', 'watchlists', 'screens', 'notes', 'portfolio', 'cc_extra', 'drawings', 'prefs'));
