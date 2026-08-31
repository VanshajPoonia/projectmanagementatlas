-- 128: a home in the product for decisions that are waiting on the owner.
--
-- PURELY ADDITIVE - one new table, no existing table, row, policy, grant or trigger is touched.
-- --allow-prod eligible on this repo's own rule.
--
-- WHY THIS IS A TABLE AND NOT A MARKDOWN FILE
-- It started as docs/product/open-owner-decisions.md, and that file had the defect this repo
-- keeps paying for: it is a hand-maintained copy of a state nobody is obliged to update. The day
-- somebody resolves a decision, the file still says "waiting on you", and there is no way to tell
-- a live decision from a stale sentence. The same reasoning that made app_modules a table rather
-- than a constant, and holds for exactly the same reason: a control nobody can act on from the
-- product is a control that rots.
--
-- WHY SUPER ADMIN ONLY
-- These are governance records. They name people, access levels and production risks, and the
-- audience is the two people who can actually act on them. Every policy is
-- private.is_super_admin_user(), which already folds in profiles.is_active (migration 101), so a
-- deactivated super admin loses this with everything else. Plain admins (Tim/Kogan/Mendy) do NOT
-- see it - widen the day one of them needs to, deliberately, rather than now.
--
-- DEPROVISIONING, decided here rather than discovered later (119's lesson)
-- created_by and resolved_by are ON DELETE SET NULL, never CASCADE and never reassigned. A
-- decision is org furniture, not personal work: deleting the person who recorded it must not
-- destroy the record, and reassigning it would make the row claim somebody else made the call.
-- Losing the attribution is the correct and only loss. app/api/admin/delete-user/route.ts
-- therefore needs NO change for this table, and check-deprovision asserts that.
--
-- Rollback: scripts/rollback/128_revert.sql, which DESTROYS every recorded decision and its
-- resolution history. Dump the table first if the intent is "roll back the code, keep the log".

BEGIN;

CREATE TABLE IF NOT EXISTS public.owner_decisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- One sentence: what is being decided. Shown in the list without expanding anything.
  summary          TEXT NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 500),
  -- The full picture: the facts, the options and what each costs.
  detail           TEXT CHECK (detail IS NULL OR length(detail) <= 8000),
  -- What the person who wrote it down would do, and why. Optional, because some decisions
  -- genuinely have no defensible recommendation and pretending otherwise is worse than silence.
  recommendation   TEXT CHECK (recommendation IS NULL OR length(recommendation) <= 4000),
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'resolved', 'dismissed')),
  -- What was actually decided. Required to leave 'open' - see the trigger below.
  resolution_note  TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 4000),
  resolved_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at      TIMESTAMPTZ,
  position         INTEGER NOT NULL DEFAULT 0,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_decisions_status_position
  ON public.owner_decisions (status, position, created_at);

-- ---------------------------------------------------------------------------------------
-- A decision closed with no reason is a decision nobody can revisit.
--
-- ⚠️ Enforced in a trigger rather than a CHECK because the timestamps have to be STAMPED, not
-- merely validated, and because reopening has to clear them - otherwise a reopened decision
-- carries a resolved_at in the future of its own status, which is exactly the kind of quiet
-- disagreement this repo has been bitten by (103's carrier columns).
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_owner_decision_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();

  IF NEW.status = 'open' THEN
    -- Reopening wipes the closure entirely. Keeping a stale note would leave the row asserting
    -- an outcome that is no longer true.
    NEW.resolution_note := NULL;
    NEW.resolved_by := NULL;
    NEW.resolved_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.resolution_note IS NULL OR length(btrim(NEW.resolution_note)) = 0 THEN
    RAISE EXCEPTION 'Closing a decision needs a note saying what was decided.'
      USING ERRCODE = 'check_violation',
            HINT = 'Six months from now the note is the only record of why.';
  END IF;

  -- ⚠️ On an UPDATE the stamp is authoritative: a client cannot claim somebody else closed a
  -- decision, or backdate the moment it was closed. On an INSERT a supplied value is honoured,
  -- because recording a decision that was genuinely made last week is a real need and the only
  -- people who can write here are super admins. The asymmetry is the point: the record of
  -- WHEN A LIVE DECISION CHANGED cannot be forged, while entering history stays possible.
  IF TG_OP = 'INSERT' THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, now());
    NEW.resolved_by := COALESCE(NEW.resolved_by, auth.uid());
  ELSIF OLD.status = 'open' OR NEW.status <> OLD.status THEN
    NEW.resolved_at := now();
    NEW.resolved_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_owner_decision_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_owner_decision_state ON public.owner_decisions;
CREATE TRIGGER enforce_owner_decision_state
  BEFORE INSERT OR UPDATE ON public.owner_decisions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_owner_decision_state();

-- ---------------------------------------------------------------------------------------
-- Grants. ⚠️ Supabase default-grants ALL on every new table in public to anon AND
-- authenticated, so granting narrowly is not enough - the wide grant is already there (090's
-- lesson, and 095 closed it for anon workspace-wide, but REVOKE first regardless).
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.owner_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_decisions TO authenticated;

ALTER TABLE public.owner_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins read decisions"   ON public.owner_decisions;
DROP POLICY IF EXISTS "Super admins create decisions" ON public.owner_decisions;
DROP POLICY IF EXISTS "Super admins update decisions" ON public.owner_decisions;
DROP POLICY IF EXISTS "Super admins delete decisions" ON public.owner_decisions;

CREATE POLICY "Super admins read decisions" ON public.owner_decisions
  FOR SELECT TO authenticated USING (private.is_super_admin_user());
CREATE POLICY "Super admins create decisions" ON public.owner_decisions
  FOR INSERT TO authenticated WITH CHECK (private.is_super_admin_user());
CREATE POLICY "Super admins update decisions" ON public.owner_decisions
  FOR UPDATE TO authenticated
  USING (private.is_super_admin_user()) WITH CHECK (private.is_super_admin_user());
CREATE POLICY "Super admins delete decisions" ON public.owner_decisions
  FOR DELETE TO authenticated USING (private.is_super_admin_user());

-- ---------------------------------------------------------------------------------------
-- Seed: the decisions that were live when this table was created, so the screen is useful on
-- the day it ships rather than being an empty box somebody has to populate by hand.
--
-- ⚠️ Idempotent on `title`, so re-running changes nothing and a decision an owner has since
-- edited or resolved is never overwritten by a re-run.
-- ---------------------------------------------------------------------------------------
INSERT INTO public.owner_decisions (title, summary, detail, recommendation, status, resolution_note, resolved_at, position)
VALUES
(
  'Should a work-in-progress limit refuse, or only warn?',
  'Migration 125 would make a column''s WIP limit a real refusal instead of a warning. It is applied to the dev sandbox and deliberately not to production.',
  'A board column can carry a work-in-progress limit. Today, hitting that limit shows a warning and lets the move through, and the badge says so honestly rather than promising a refusal that will not happen.'
  || E'\n\nWhy it is held back: the change puts a trigger on the tasks table, so it would run on every task move on every board in the product, forever. If it were wrong the failure is not "agile misbehaves", it is "nobody can drag a card". This workspace''s rule is that only purely additive changes reach production on an engineer''s own judgement.'
  || E'\n\nWhat applying it would buy today: nothing. No column carries a limit, no board has agile settings, so it would do nothing at all until somebody sets a limit and switches a board to enforcement.',
  'Leave it. Revisit the day a team is genuinely using WIP limits and reports that the warning gets ignored. There is no cost to waiting, and the migration runner now refuses to apply it by accident.',
  'resolved',
  'Decided 2026-08-30: not applying it. Nothing shipped depends on it, and the product is honest without it. Registered as a held migration so it cannot be applied by accident, and the decision can be revisited any time.',
  '2026-08-30T00:00:00Z',
  10
),
(
  'The TEST marketing calendar, and who can see marketing work',
  'A leftover test calendar sat beside the real Marketing Calendar in the switcher. Archiving it removed one person''s access to the Marketing area.',
  'Production had three marketing calendars: Marketing Calendar (1355 events, 2 members), TEST (0 events, 3 members) and Kayla''s Personal (already archived).'
  || E'\n\nThe catch was that Vanshaj was a member of TEST and of nothing else, and the Marketing tab is shown to anyone who is an admin or a member of at least one calendar. So archiving TEST removed their Marketing tab entirely.',
  NULL,
  'resolved',
  'Decided 2026-08-30: Vanshaj does not need access to the real Marketing Calendar, so TEST was archived and that access ended. Archived rather than deleted, so nothing was destroyed: the calendar, its 3 membership rows and all 1355 events on the real calendar are untouched, and one UPDATE reverses it.',
  '2026-08-30T00:00:00Z',
  20
),
(
  'Four tasks are marked as repeating but have no schedule',
  'Four tasks on Marketing PM Sheet say they repeat, but no cadence was ever set, so nothing has ever been created from them.',
  'The four are: "Before & After Pix Constantly", "Begin and continuisouly develope a Handyman Handbook", "Get with Beth Smith @ SGR to particpate more often", and "Migrate AGC clients in HOUZZ to Brevo". All were created 2026-06-18 and none has a due date.'
  || E'\n\nWhen the recurrence engine shipped, it deliberately refused to guess whether "repeats" meant daily or monthly, so these four kept the flag and got no schedule. Nothing is broken and the app is already honest about it: opening any of them shows "This task is marked as repeating, but it has no schedule, so nothing has ever been created from it", with a "Set up a real schedule" button.'
  || E'\n\nSo the only cost of leaving them is four tasks carrying a prompt nobody has answered.',
  'Read as written they are ongoing efforts rather than scheduled repeats, and "constantly" is not a cadence. Clearing the repeating flag on all four is the honest tidy-up. If any of them genuinely does repeat, open it and press "Set up a real schedule".',
  'open',
  NULL,
  NULL,
  30
),
(
  'Which boards should use agile mode',
  'Agile mode is switched on for the workspace, and no board uses it yet. Picking a first board is the only item on this list with real upside.',
  'Turning the module on only made the Agile page reachable. Every board still works exactly as it did, and will until an admin turns agile on for that specific board.'
  || E'\n\nAgile suits work that runs in repeating cycles with a stopping point, such as marketing pushes and internal project work. It suits open-ended contracting jobs badly, where a two-week window is an arbitrary line through a job that runs for months. Choosing the wrong board first teaches you the feature does not work, when it is the board that does not fit.',
  'Pick one board where work genuinely runs in cycles and turn it on: Agile in the sidebar, choose the board, press "Turn on agile for this board". Use it for two windows before judging it, because velocity is an average across finished windows and one window produces no number. Turning it back off leaves the board exactly as it was.',
  'open',
  NULL,
  NULL,
  40
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------
-- Post-conditions. This migration rolls back whole rather than half-applying.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_open BIGINT; v_resolved BIGINT; v_policies INT; v_ok BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'owner_decisions'
                   AND rowsecurity) THEN
    RAISE EXCEPTION 'RLS is not enabled on owner_decisions. Aborting.';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'owner_decisions';
  IF v_policies <> 4 THEN
    RAISE EXCEPTION 'Expected 4 policies on owner_decisions, found %. Aborting.', v_policies;
  END IF;

  -- ⚠️ Asserted rather than assumed: anon must hold nothing, and a plain admin must not be able
  -- to read this. Both are the whole point of the table being super-admin-only.
  IF has_table_privilege('anon', 'public.owner_decisions', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read owner_decisions. Aborting.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'owner_decisions'
       AND qual NOT LIKE '%is_super_admin_user%' AND qual IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A policy on owner_decisions is not gated on is_super_admin_user. Aborting.';
  END IF;

  -- The trigger must actually refuse a closure with no note. "The constraint exists" and "the
  -- constraint refuses this" are different claims (117's lesson), so try it.
  BEGIN
    INSERT INTO public.owner_decisions (title, summary, status)
    VALUES ('__postcondition probe__', 'probe', 'resolved');
    RAISE EXCEPTION 'A decision was closed with no note. Aborting.';
  EXCEPTION WHEN check_violation THEN
    NULL; -- refused, which is correct
  END;

  SELECT count(*) FILTER (WHERE status = 'open'),
         count(*) FILTER (WHERE status = 'resolved')
    INTO v_open, v_resolved
    FROM public.owner_decisions;

  RAISE NOTICE '128 verified: owner_decisions created, super-admin-only, % open and % resolved seeded.',
    v_open, v_resolved;
END $$;

COMMIT;
