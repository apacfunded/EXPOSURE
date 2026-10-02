-- Daily Top 20 bonus. Run once in Supabase > SQL Editor.
create table if not exists top20_days (
  day date primary key, pool_lamports bigint not null, plan jsonb not null,
  status text not null default 'sending' check (status in ('sending','done','failed')),
  created_at timestamptz not null default now(), finished_at timestamptz
);
alter table top20_days enable row level security;
revoke all on top20_days from anon, authenticated;
