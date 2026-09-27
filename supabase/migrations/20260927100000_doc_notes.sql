-- Sankhyas: AI summaries made on demand (doc-ai Edge Function), shared by every visitor, and a
-- short-lived cache of NSE filing lists fetched on demand.

-- one summary per document URL; summaries of public exchange filings are public
create table if not exists public.doc_notes (
  url text primary key,
  symbol text,
  kind text not null check (kind in ('transcript', 'ppt', 'ar')),
  note jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists doc_notes_symbol_idx on public.doc_notes (symbol);
alter table public.doc_notes enable row level security;
drop policy if exists "summaries are public" on public.doc_notes;
create policy "summaries are public" on public.doc_notes for select to anon, authenticated using (true);
revoke insert, update, delete on public.doc_notes from anon, authenticated;

-- filing lists fetched from NSE on demand, kept for a few hours (service role only)
create table if not exists public.doc_cache (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.doc_cache enable row level security;
revoke all on public.doc_cache from anon, authenticated;
