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
