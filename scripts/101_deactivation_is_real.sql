-- Deactivating an account has never actually done anything.
--
-- `profiles.is_active` has existed for a long time and the Super Admin screen has a
-- prominent Activate/Deactivate toggle that writes it. Nothing reads it. Verified against
-- the live database before writing this: **zero** RLS policies reference it, **zero**
-- SECURITY DEFINER helpers reference it, and **zero** lines of application code outside the
-- toggle that sets it. A "deactivated" person could sign in and keep working with full
-- access, while the admin who deactivated them saw a red "Inactive" badge and believed
-- access had been revoked.
--
-- That is the worst shape a security control can take: not missing, but present and
-- believed. It also mattered more than it looks, because deactivation is the *reversible*
-- alternative to deleting somebody. With it inert, the only working way to remove access was
-- permanent deletion — which is exactly the unsafe path.
--
-- ── What actually enforces it ────────────────────────────────────────────────────────
-- Three layers, because no single one is sufficient on its own:
--
--   1. GoTrue ban (app/api/admin/set-user-active/route.ts). Blocks sign-in and refresh-token
--      exchange at the auth server. This is the real boundary — it does not depend on any
--      application code being correct.
--   2. This migration, for the window that layer 1 cannot close. A ban stops NEW tokens; an
--      access token already in a browser stays valid until it expires (about an hour). RLS
--      is evaluated per request, so folding the check into these helpers revokes elevated
--      access on the very next query rather than an hour later.
--   3. proxy.ts, which signs them out on the next page load so the UI does not sit there
--      half-working.
--
-- ── Why only the admin helpers ───────────────────────────────────────────────────────
-- `is_admin_user()` and `is_super_admin_user()` are the two chokepoints every elevated
-- capability in the schema already routes through, so changing them here covers all of it in
-- one place. Baseline read access for a signed-in user is deliberately NOT gated on
-- is_active: those policies test `auth.uid() IS NOT NULL` individually, roughly fifty of
-- them, and rewriting all fifty at the tail of this change would be a large blast radius for
-- a window the ban already closes within the hour. The consequence is explicit and bounded:
-- for up to one token lifetime a just-deactivated person may still READ what they could
-- read before. They cannot administer anything, and they cannot get a new token.
--
-- COALESCE(is_active, true) throughout: the column is nullable and NULL has always meant
-- active. Reading NULL as inactive would lock out every account whose row predates the
-- column. (Checked: 0 NULL and 0 false rows on dev at the time of writing, so this migration
-- changes nobody's access on the day it lands.)

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID;

COMMENT ON COLUMN public.profiles.is_active IS
  'False revokes access. Enforced by a GoTrue ban plus private.is_active_user() (101). Reversible — prefer this to deletion.';

CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND COALESCE(is_active, true)
  );
$$;

REVOKE ALL ON FUNCTION private.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated;

-- Same bodies as before, with the active check ANDed on. Every existing caller keeps working
-- unchanged; the only behavioural difference is for a deactivated account, which previously
-- kept every one of its powers.
CREATE OR REPLACE FUNCTION private.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND COALESCE(is_active, true)
  );
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND COALESCE(is_active, true)
  );
$$;

-- A deactivated person must not be able to write work either, even inside the token window.
-- can_manage_task is the single gate behind task create/edit/delete.
CREATE OR REPLACE FUNCTION private.can_manage_task(
  p_task_id UUID,
  p_created_by UUID,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND private.is_active_user()
    AND NOT private.task_hidden_by_board_privacy(p_task_id)
    AND NOT private.task_restricted_by_board_role(p_task_id)
    AND (
      private.is_admin_user()
      OR p_created_by = auth.uid()
      OR p_assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.task_assignees ta
        WHERE ta.task_id = p_task_id
          AND ta.user_id = auth.uid()
      )
    );
$$;

-- ── The write policies that do NOT route through can_manage_task ─────────────────────
-- Patching the helper above is not enough on its own, and the harness caught it: creating a
-- task never calls can_manage_task, because migration 067 had to key the INSERT check off a
-- COLUMN id (the task has no id yet). Comments and chat messages have their own checks for
-- the same reason. Each is amended here rather than left to the ban alone, so "switched off"
-- means the same thing on every path that makes work.
DROP POLICY IF EXISTS "Collaborators can create tasks" ON public.tasks;
CREATE POLICY "Collaborators can create tasks"
  ON public.tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND private.is_active_user()
    AND created_by = auth.uid()
    AND NOT private.column_hidden_by_board_privacy(column_id)
    AND NOT private.column_restricted_by_board_role(column_id)
  );

DROP POLICY IF EXISTS "Collaborators can create task comments" ON public.task_comments;
CREATE POLICY "Collaborators can create task comments"
  ON public.task_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    private.is_active_user()
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_comments.task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Users can send chat messages" ON public.chat_messages;
CREATE POLICY "Users can send chat messages"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    private.is_active_user()
    AND sender_id = auth.uid()
    AND recipient_id <> auth.uid()
    AND recipient_id IN (SELECT profiles.id FROM public.profiles)
  );

-- ── Only a super admin may change activation ─────────────────────────────────────────
-- profiles UPDATE is "users can update own profile", which meant anyone could clear their
-- own is_active — and, once this migration makes the flag load-bearing, could equally set it
-- back to true after being deactivated. The column-level revoke is what stops that: RLS
-- decides which ROWS you may touch, privileges decide which COLUMNS.
-- ⚠️ A column-level REVOKE cannot shrink a table-wide grant, and `authenticated` held
-- UPDATE on the whole table. Revoking specific columns silently changed nothing — this
-- migration's own post-condition caught that on the first run. The only way to narrow it is
-- to drop the table-wide grant and re-grant the exact columns that stay self-service.
-- (Same shape as the `REVOKE ... FROM PUBLIC` trap documented for function EXECUTE grants.)
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  full_name,
  avatar_url,
  updated_at,
  notify_email_assignment,
  notify_email_update,
  notify_email_comment,
  notify_email_due_soon
) ON public.profiles TO authenticated;

-- ── Audit ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.audit_profile_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_active, true) IS NOT DISTINCT FROM COALESCE(OLD.is_active, true) THEN
    RETURN NEW;
  END IF;

  PERFORM private.record_audit_event(
    CASE WHEN COALESCE(NEW.is_active, true) THEN 'profile.reactivated' ELSE 'profile.deactivated' END,
    'profile', NEW.id, NEW.id,
    format('%s''s access was %s.', private.audit_person_name(NEW.id),
           CASE WHEN COALESCE(NEW.is_active, true) THEN 'restored' ELSE 'switched off' END),
    jsonb_build_object('is_active', COALESCE(NEW.is_active, true))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_active ON public.profiles;
CREATE TRIGGER trg_audit_profile_active
  AFTER UPDATE OF is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_profile_active();

-- ── Post-conditions ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- The whole point: these must now consult is_active. Asserted by reading the deployed
  -- source, so a later CREATE OR REPLACE that drops the check fails this migration's own
  -- guarantee loudly rather than silently.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = 'is_admin_user') NOT LIKE '%is_active%' THEN
    RAISE EXCEPTION 'is_admin_user does not check is_active';
  END IF;

  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = 'is_super_admin_user') NOT LIKE '%is_active%' THEN
    RAISE EXCEPTION 'is_super_admin_user does not check is_active';
  END IF;

  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = 'can_manage_task') NOT LIKE '%is_active_user%' THEN
    RAISE EXCEPTION 'can_manage_task does not check is_active_user';
  END IF;

  -- A self-service route around the flag would make all of the above pointless.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
      AND column_name IN ('is_active', 'role', 'deactivated_at', 'deactivated_by')
  ) THEN
    RAISE EXCEPTION 'authenticated can still UPDATE a protected profile column';
  END IF;

  -- ...and the columns people legitimately edit about themselves must still work, or account
  -- settings breaks for everyone. The four notification toggles are the ones actually wired
  -- to a control today; full_name and avatar_url are kept for the same reason.
  IF (
    SELECT count(DISTINCT column_name) FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
      AND column_name IN ('full_name', 'avatar_url', 'notify_email_assignment',
                          'notify_email_update', 'notify_email_comment', 'notify_email_due_soon')
  ) <> 6 THEN
    RAISE EXCEPTION 'self-service profile columns lost their UPDATE grant';
  END IF;

  -- Nobody may be locked out by this migration landing.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE is_active IS NOT DISTINCT FROM false) THEN
    RAISE WARNING 'some accounts are already flagged inactive and will now genuinely lose access';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_profile_active' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'the activation audit trigger is missing';
  END IF;

  -- Every path that CREATES work must consult is_active. These three do not go through
  -- can_manage_task, so amending that helper alone left a deactivated person still able to
  -- create tasks — which is exactly what the first run of check-deactivation.mjs found.
  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'INSERT'
      AND tablename IN ('tasks', 'task_comments', 'chat_messages')
      AND with_check LIKE '%is_active_user%'
  ) <> 3 THEN
    RAISE EXCEPTION 'a work-creating INSERT policy does not check is_active_user';
  END IF;
END $$;

COMMIT;
