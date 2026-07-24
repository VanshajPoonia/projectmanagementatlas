-- Minimal, production-safe version of 070's fix. 070 (dev-only so far) depends on migration
-- 069's private.is_super_admin_user() and also tightens archived-board visibility to
-- super_admin — bundling in unrelated feature work this file deliberately does NOT push to
-- production yet (069's cancel-archive automation / admin restrictions haven't been vetted
-- against prod's real user base). This file does the ONE thing that's actually a security fix:
--
-- `boards` has had two overlapping SELECT RLS policies since 061_private_board_access.sql —
--   "Users can view boards" (061): (privacy check) AND (archived_at IS NULL OR is_admin_user())
--   "View active boards, admins see archived too" (036/047): archived_at IS NULL OR is_admin_user()
-- Postgres OR's multiple permissive policies for the same command together. The second policy's
-- clause is true for ANY non-archived board regardless of privacy, silently defeating the first
-- policy's privacy check for every non-archived board. Confirmed live on the dev sandbox before
-- this fix: a plain authenticated user with no board membership could read a private board's row
-- directly. 061 predates this file and is already live in production (prod was last at 063).
--
-- Fix: drop the redundant, privacy-blind policy. "Users can view boards" (061) already correctly
-- combines privacy AND archived-visibility — nothing else needs to change, and archived-board
-- visibility semantics are deliberately left exactly as they are today (still admin-level, not
-- tightened to super_admin here — that's 069/070's concern, for a separate, explicit prod push).

BEGIN;

DROP POLICY IF EXISTS "View active boards, admins see archived too" ON public.boards;
DROP POLICY IF EXISTS "View active boards, super admins see archived too" ON public.boards;

COMMIT;
