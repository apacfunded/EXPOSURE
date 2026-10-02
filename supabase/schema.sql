-- Exposure database. Paste into Supabase > SQL Editor and run once.
-- Every table has row-level security ON and NO policies, and public roles get no grants,
-- so only the server (service-role key, stored in Vercel env) can read or write.

create table if not exists coins (
  mint text primary key,
  ticker text not null, name text not null, img text, description text, twitter text,
  quote text not null default 'SOL', fee_pct numeric not null default 0.3,
  creator text not null,              -- wallet that launched it (signed + paid)
  pool_wallet text not null unique,   -- per-coin wallet that receives pump.fun creator fees
  launch_sig text, confirmed boolean not null default false,
  mc numeric not null default 0, paid_lamports bigint not null default 0,
  pool_lamports bigint not null default 0,   -- refreshed by the claim job (claimed + still in pump.fun's vault)
  round_no int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists mc_history (
  mint text references coins(mint) on delete cascade, t timestamptz not null, mc numeric not null,
  primary key (mint, t)
);

create table if not exists callers (
  wallet text primary key, username text,
  x_handle text, x_name text, x_avatar text, x_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists callouts (
  id text primary key,                -- platform:platform_id, so the same callout is never counted twice
  platform text not null check (platform in ('pump','fomo','gmgn')),
  wallet text not null, username text, mint text not null references coins(mint) on delete cascade,
  likes int not null default 0, holder_likes int not null default 0, weight numeric not null default 0,
  mc_at_call numeric, peak_mc_24h numeric, won boolean,
  posted_at timestamptz not null, round_paid_at timestamptz,   -- null = still in this coin's current round
  created_at timestamptz not null default now()
);
create index if not exists callouts_mint_round on callouts (mint) where round_paid_at is null;
create index if not exists callouts_wallet on callouts (wallet);

-- One row per payout attempt. The unique (mint, round_no) makes a round impossible to pay twice.
create table if not exists payout_rounds (
  id bigserial primary key, mint text not null references coins(mint), round_no int not null,
  pool_lamports bigint not null, plan jsonb not null,
  status text not null default 'planned' check (status in ('planned','sending','done','failed')),
  created_at timestamptz not null default now(), finished_at timestamptz,
  unique (mint, round_no)
);

create table if not exists payouts (
  id bigserial primary key, round_id bigint references payout_rounds(id), mint text not null,
  wallet text not null, platform text, likes int, lamports bigint not null,
  kind text not null check (kind in ('payout','top20','reserve')),
  tx text, status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now(),
  unique (round_id, wallet, kind)
);

create table if not exists activity (
  id bigserial primary key, kind text not null check (kind in ('claim','payout','top20','reserve','burn')),
  mint text, wallet text, lamports bigint, tx text, at timestamptz not null default now()
);

create table if not exists ratings (
  caller text not null, rater text not null, stars int not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(), primary key (caller, rater)
);

create table if not exists x_oauth (
  state text primary key, wallet text not null, verifier text not null, return_to text not null,
  created_at timestamptz not null default now()
);

create table if not exists used_sigs (hash text primary key, purpose text, at timestamptz not null default now());
create table if not exists rate_limits (key text primary key, n int not null, reset_at timestamptz not null);

-- Lock everything down.
do $$ declare t text; begin
  foreach t in array array['coins','mc_history','callers','callouts','payout_rounds','payouts','activity','ratings','x_oauth','used_sigs','rate_limits'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- Atomic rate limiter: returns true if this hit is allowed.
create or replace function hit_rate_limit(p_key text, p_max int, p_window int) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  insert into rate_limits(key, n, reset_at) values (p_key, 1, now() + make_interval(secs => p_window))
  on conflict (key) do update set
    n = case when rate_limits.reset_at < now() then 1 else rate_limits.n + 1 end,
    reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => p_window) else rate_limits.reset_at end
  returning n into cur;
  return cur <= p_max;
end $$;
revoke all on function hit_rate_limit(text, int, int) from public, anon, authenticated;

-- Star averages per caller (only counted from wallets that passed the holder check at rating time).
create or replace view caller_stars as
  select caller, round(avg(stars)::numeric, 2) as stars, count(*) as stars_n from ratings group by caller;
revoke all on caller_stars from anon, authenticated;

-- Housekeeping: old replay hashes and OAuth states can go after a day.
create or replace function cleanup() returns void language sql security definer set search_path = public as $$
  delete from used_sigs where at < now() - interval '1 day';
  delete from x_oauth where created_at < now() - interval '15 minutes';
  delete from rate_limits where reset_at < now() - interval '1 hour';
$$;
revoke all on function cleanup() from public, anon, authenticated;
-- Callouts now happen on Exposure itself, scored by holdings and PnL. Run once in Supabase > SQL Editor.
alter table callouts drop constraint if exists callouts_platform_check;
alter table callouts add constraint callouts_platform_check check (platform in ('exposure','pump','fomo','gmgn'));
alter table callouts add column if not exists tokens_at_call numeric;   -- caller's holding when they called (UI tokens)
alter table callouts add column if not exists tokens_now numeric;       -- refreshed every few minutes
alter table callouts add column if not exists pnl numeric;              -- coin's gain since the call, 0.5 = +50%
alter table callouts add column if not exists note text;
-- one open callout per wallet per coin per round
create unique index if not exists callouts_one_per_round on callouts (wallet, mint) where round_paid_at is null;

alter table payouts add column if not exists hold_pct numeric;
alter table payouts add column if not exists pnl numeric;
