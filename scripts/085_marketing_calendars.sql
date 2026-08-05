-- Turn the single implicit marketing calendar (hardcoded to kayla@goatlasgo.us via
-- KAYLA_EMAIL in components/marketing/marketing-calendar.tsx) into admin-creatable, named,
-- multiple calendar instances, each with its own explicit member list.
--
-- Root problem being fixed: marketing_calendar_items.assigned_to (a plain single-user FK) was
-- being hijacked by the app to mean "which calendar," not "who is this item for" — every write
-- path stamped assigned_to with the resolved owner's id regardless of who actually acted. That's
-- the same "two competing sources of truth" shape migration 063 already fixed once for task
-- statuses. The fix here is the same kind: a real calendar_id column + a real table, not another
-- overload of an existing column.
--
-- Every existing row is backfilled onto one new calendar named 'Marketing Calendar', owned by
-- Kayla, with her as its first member — nothing changes for existing data or today's users.
-- No role column on membership (every member gets full CRUD, matching what Kayla alone has
-- today) — mirrors teams' own "kept simpler than first sketched, add a role later if needed"
-- precedent rather than repeating board_members' dead-UPDATE-grant mistake.

BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.marketing_calendar_members (
  calendar_id UUID NOT NULL REFERENCES public.marketing_calendars(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (calendar_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_calendar_members_user_id
  ON public.marketing_calendar_members(user_id);

ALTER TABLE public.marketing_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_calendar_members ENABLE ROW LEVEL SECURITY;

-- No DELETE grant on marketing_calendars at all — archive-only by construction (cheaper than
-- boards' retrofitted hard-delete-blocking trigger, since this is a brand-new table). No UPDATE
-- grant on marketing_calendar_members — there's no mutable column (no role), so no UPDATE policy
-- is needed either, unlike board_members' dead role-UPDATE-grant gap.
GRANT SELECT, INSERT, UPDATE ON public.marketing_calendars TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.marketing_calendar_members TO authenticated;

-- Single chokepoint for "is this user allowed into this calendar," mirroring the established
-- pattern (public.is_board_member, private.task_restricted_by_board_role) instead of repeating
-- the same join inline across ~11 policies below.
CREATE OR REPLACE FUNCTION private.is_calendar_member(p_calendar_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.marketing_calendar_members mm
    WHERE mm.calendar_id = p_calendar_id
      AND mm.user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION private.is_calendar_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_calendar_member(UUID, UUID) TO authenticated;

-- No is_archived clause here, deliberately — mirrors companies' "stays visible forever, just
-- can't be picked for new content" model, not boards' post-061 harder hide-from-everyone model.
DROP POLICY IF EXISTS "Members view their calendars" ON public.marketing_calendars;
CREATE POLICY "Members view their calendars"
  ON public.marketing_calendars FOR SELECT
  TO authenticated
  USING (
    private.is_admin_user()
    OR private.is_calendar_member(id, auth.uid())
  );

-- Blanket admin bypass, no creator-only carve-out — deliberate divergence from boards' current
-- (post-061) shape, where even other admins are locked out of a private board's own membership.
-- The ask here is "admin manages other people's access," not "hide this from other admins."
DROP POLICY IF EXISTS "Admins manage calendars" ON public.marketing_calendars;
CREATE POLICY "Admins manage calendars"
  ON public.marketing_calendars FOR ALL
  TO authenticated
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

-- A member sees their own row (so the client can tell "do I have access"); only admins see a
-- calendar's full roster — mirrors board_members' SELECT shape.
DROP POLICY IF EXISTS "View own calendar membership" ON public.marketing_calendar_members;
CREATE POLICY "View own calendar membership"
  ON public.marketing_calendar_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR private.is_admin_user()
  );

DROP POLICY IF EXISTS "Admins manage calendar membership" ON public.marketing_calendar_members;
CREATE POLICY "Admins manage calendar membership"
  ON public.marketing_calendar_members FOR ALL
  TO authenticated
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

-- Add the real grouping column, nullable at first so it can be backfilled before the NOT NULL
-- constraint is applied (see below — the ALTER COLUMN SET NOT NULL doubles as a verification
-- gate: if any row were somehow missed by the backfill, that statement fails loudly and the
-- whole transaction rolls back, rather than silently leaving an orphaned row).
ALTER TABLE public.marketing_calendar_items
  ADD COLUMN IF NOT EXISTS calendar_id UUID REFERENCES public.marketing_calendars(id) ON DELETE RESTRICT;

DO $$
DECLARE
  v_kayla_id UUID;
  v_calendar_id UUID;
BEGIN
  SELECT id INTO v_kayla_id
  FROM public.profiles
  WHERE lower(email) = 'kayla@goatlasgo.us'
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.marketing_calendars (name, created_by)
  VALUES ('Marketing Calendar', v_kayla_id)
  RETURNING id INTO v_calendar_id;

  IF v_kayla_id IS NOT NULL THEN
    INSERT INTO public.marketing_calendar_members (calendar_id, user_id)
    VALUES (v_calendar_id, v_kayla_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Unconditional: every existing row (100% of them, today all implicitly Kayla's) moves onto
  -- the new default calendar. No row is left behind or excluded by any filter beyond "not yet
  -- backfilled in this same statement."
  UPDATE public.marketing_calendar_items
  SET calendar_id = v_calendar_id
  WHERE calendar_id IS NULL;
END $$;

ALTER TABLE public.marketing_calendar_items
  ALTER COLUMN calendar_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_calendar_items_calendar_id
  ON public.marketing_calendar_items(calendar_id);

COMMENT ON COLUMN public.marketing_calendar_items.assigned_to IS
  'The user who created/is nominally responsible for this specific item. No longer used for '
  'access control as of migration 085 (see calendar_id + marketing_calendar_members) — kept for '
  'informational/historical purposes only.';

-- Replace the four assigned_to-keyed policies (047's SELECT + 050's three write policies) with
-- membership-based equivalents. The blanket "Admins manage marketing calendar items" ALL policy
-- is untouched below — it already grants full admin bypass, nothing to change there.
DROP POLICY IF EXISTS "Users view assigned marketing calendar items" ON public.marketing_calendar_items;
CREATE POLICY "Members view calendar items"
  ON public.marketing_calendar_items FOR SELECT
  TO authenticated
  USING (private.is_calendar_member(calendar_id, auth.uid()));

DROP POLICY IF EXISTS "Users can create own marketing calendar items" ON public.marketing_calendar_items;
CREATE POLICY "Members create calendar items"
  ON public.marketing_calendar_items FOR INSERT
  TO authenticated
  WITH CHECK (private.is_calendar_member(calendar_id, auth.uid()));

-- source_sheet IS NULL preserved from the original policy: imported/spreadsheet-origin rows
-- can still only be edited/deleted through the admin bypass, same as before this migration.
DROP POLICY IF EXISTS "Users can update own marketing calendar items" ON public.marketing_calendar_items;
CREATE POLICY "Members update calendar items"
  ON public.marketing_calendar_items FOR UPDATE
  TO authenticated
  USING (private.is_calendar_member(calendar_id, auth.uid()) AND source_sheet IS NULL)
  WITH CHECK (private.is_calendar_member(calendar_id, auth.uid()));

DROP POLICY IF EXISTS "Users can delete own marketing calendar items" ON public.marketing_calendar_items;
CREATE POLICY "Members delete calendar items"
  ON public.marketing_calendar_items FOR DELETE
  TO authenticated
  USING (private.is_calendar_member(calendar_id, auth.uid()) AND source_sheet IS NULL);

-- marketing_calendar_checks: narrower than items above, and deliberately so. SELECT
-- ("Users view own marketing calendar checks") and DELETE ("Users delete own marketing calendar
-- checks") are left completely untouched — statusByItem in marketing-calendar.tsx is a
-- Map<item_id, Check>, one entry per item. Widening SELECT to calendar-membership-wide would let
-- two different members each hold an independent check row on the same shared item (the unique
-- index is (item_id, user_id), which permits exactly that), and the client's `new Map(...)`
-- construction would silently drop one member's mark with no error. Nothing this feature needs
-- requires "see teammates' checkmarks," so only INSERT/UPDATE's ownership clause is swapped from
-- item.assigned_to = auth.uid() to a calendar-membership join (so a non-member can't check off an
-- item they can't see).
COMMENT ON COLUMN public.marketing_calendar_checks.user_id IS
  'The user who marked this item posted/missed. No longer implies calendar ownership as of '
  'migration 085 — access is governed by calendar_id on the parent item plus '
  'marketing_calendar_members, not by this column.';

DROP POLICY IF EXISTS "Users create own marketing calendar checks" ON public.marketing_calendar_checks;
CREATE POLICY "Members create own calendar item checks"
  ON public.marketing_calendar_checks FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND private.is_calendar_member(item.calendar_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users update own marketing calendar checks" ON public.marketing_calendar_checks;
CREATE POLICY "Members update own calendar item checks"
  ON public.marketing_calendar_checks FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND private.is_calendar_member(item.calendar_id, auth.uid())
    )
  );

-- marketing_calendar_item_companies: both policies inline their own admin check (no separate
-- blanket ALL policy exists for this table), so private.is_admin_user() is preserved inline here.
DROP POLICY IF EXISTS "View item companies for visible items" ON public.marketing_calendar_item_companies;
CREATE POLICY "View item companies for visible items"
  ON public.marketing_calendar_item_companies FOR SELECT
  TO authenticated
  USING (
    private.is_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.marketing_calendar_items i
      WHERE i.id = item_id AND private.is_calendar_member(i.calendar_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Manage item companies for own items" ON public.marketing_calendar_item_companies;
CREATE POLICY "Manage item companies for own items"
  ON public.marketing_calendar_item_companies FOR ALL
  TO authenticated
  USING (
    private.is_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.marketing_calendar_items i
      WHERE i.id = item_id AND private.is_calendar_member(i.calendar_id, auth.uid())
    )
  )
  WITH CHECK (
    private.is_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.marketing_calendar_items i
      WHERE i.id = item_id AND private.is_calendar_member(i.calendar_id, auth.uid())
    )
  );

-- marketing_calendar_attachments: same inline-admin-check shape as item_companies above.
DROP POLICY IF EXISTS "View images for visible marketing events" ON public.marketing_calendar_attachments;
CREATE POLICY "View images for visible marketing events"
  ON public.marketing_calendar_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  );

DROP POLICY IF EXISTS "Attach images to visible marketing events" ON public.marketing_calendar_attachments;
CREATE POLICY "Attach images to visible marketing events"
  ON public.marketing_calendar_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  );

DROP POLICY IF EXISTS "Replace images on visible marketing events" ON public.marketing_calendar_attachments;
CREATE POLICY "Replace images on visible marketing events"
  ON public.marketing_calendar_attachments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  )
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  );

DROP POLICY IF EXISTS "Remove images from visible marketing events" ON public.marketing_calendar_attachments;
CREATE POLICY "Remove images from visible marketing events"
  ON public.marketing_calendar_attachments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  );

-- storage.objects (marketing-assets bucket): same shape, keyed off the item UUID folder prefix.
DROP POLICY IF EXISTS "View marketing event image objects" ON storage.objects;
CREATE POLICY "View marketing event image objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id::TEXT = (storage.foldername(name))[1]
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  );

DROP POLICY IF EXISTS "Upload marketing event image objects" ON storage.objects;
CREATE POLICY "Upload marketing event image objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id::TEXT = (storage.foldername(name))[1]
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  );

DROP POLICY IF EXISTS "Delete marketing event image objects" ON storage.objects;
CREATE POLICY "Delete marketing event image objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id::TEXT = (storage.foldername(name))[1]
        AND (private.is_calendar_member(item.calendar_id, (SELECT auth.uid())) OR private.is_admin_user())
    )
  );

COMMIT;
