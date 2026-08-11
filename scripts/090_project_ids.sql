-- Project ID Manager: a permanent ledger of claimed project numbers, format YYMM + a
-- 4-digit sequence beginning at 1111 (e.g. 26081111).
--
-- Owner ask: "grab a number, once it's used it can never be used again," with the claimer
-- recorded automatically from their session (NOT picked from a dropdown, which would let
-- anyone claim a number under a colleague's name) and a client name captured for later
-- cross-reference.
--
-- Why an RPC instead of a plain INSERT policy: allocating "the next number" is a
-- read-then-write, so two people clicking Grab at the same moment would both read the same
-- MAX(sequence) under READ COMMITTED and race. The UNIQUE constraint below would reject the
-- loser with a raw 23505 rather than handing them the next number. public.claim_project_id()
-- serializes per year-month with pg_advisory_xact_lock — the same shape book_appointment()
-- uses for overlapping slots (migration 082) — and stamps grabbed_by from auth.uid() so the
-- attribution is not client-supplied. authenticated is granted NO insert on the table at all;
-- the function is the only write path in.
--
-- Permanence is structural, not a hidden button: there is no DELETE grant and no DELETE
-- policy, so nothing can un-claim a number. The only mutable fields are the cross-reference
-- ones (client name, company), granted column-wise so an UPDATE cannot rewrite the number,
-- the claimer, or the timestamp even for an admin.
--
-- The YYMM prefix is computed in America/Chicago, not UTC. Claiming at 11pm Central on
-- Aug 31 would otherwise be stamped with September's prefix.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,            -- the full 'YYMMNNNN' number as displayed
  year_month TEXT NOT NULL,            -- 'YYMM' prefix, Central time at the moment of claiming
  seq INTEGER NOT NULL,                -- 1111..9999 within that year_month
  client_name TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  grabbed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Snapshot of the claimer's display name. The FK above goes NULL if the profile is ever
  -- deleted; this ledger has to stay readable as a historical record, so who took the number
  -- is stored as text at claim time as well.
  grabbed_by_name TEXT NOT NULL,
  grabbed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT project_ids_seq_range CHECK (seq BETWEEN 1111 AND 9999),
  CONSTRAINT project_ids_year_month_format CHECK (year_month ~ '^[0-9]{4}$'),
  CONSTRAINT project_ids_client_name_present CHECK (btrim(client_name) <> '')
);

-- Two independent guarantees: the rendered number is unique, and so is the (month, sequence)
-- pair it is derived from. Either alone would be enough; both together mean a bug in the
-- formatting cannot quietly produce a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_ids_project_id ON public.project_ids (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_ids_month_seq ON public.project_ids (year_month, seq);
CREATE INDEX IF NOT EXISTS idx_project_ids_grabbed_at ON public.project_ids (grabbed_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_ids_grabbed_by ON public.project_ids (grabbed_by);

ALTER TABLE public.project_ids ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges hand every new table in `public` a blanket ALL to anon and
-- authenticated, so granting narrowly is not enough — the wide grant is already there and has
-- to be taken away first. Same trap the appointments migrations hit twice; the post-conditions
-- at the bottom of this file are what caught it here.
REVOKE ALL ON public.project_ids FROM PUBLIC;
REVOKE ALL ON public.project_ids FROM anon;
REVOKE ALL ON public.project_ids FROM authenticated;

-- No INSERT (claim_project_id owns that), no DELETE (the ledger is permanent). UPDATE is
-- column-scoped: only the cross-reference fields can ever be corrected.
GRANT SELECT ON public.project_ids TO authenticated;
GRANT UPDATE (client_name, company_id) ON public.project_ids TO authenticated;

-- The ledger is a shared company reference — the whole point is looking up who took which
-- number — so it reads like boards/companies do: visible to everyone signed in.
DROP POLICY IF EXISTS "Anyone can view project ids" ON public.project_ids;
CREATE POLICY "Anyone can view project ids"
  ON public.project_ids FOR SELECT
  TO authenticated
  USING (true);

-- A typo'd client name should be fixable by the person who made it, without opening the row
-- up generally. Paired with the column grant above, this cannot touch the number itself.
-- is_admin_user() covers admin AND super_admin (migration 047) — deliberately not an inline
-- role = 'admin' test, which would exclude both super admins (see CLAUDE.md).
DROP POLICY IF EXISTS "Claimer or admin can correct the cross-reference" ON public.project_ids;
CREATE POLICY "Claimer or admin can correct the cross-reference"
  ON public.project_ids FOR UPDATE
  TO authenticated
  USING (grabbed_by = (SELECT auth.uid()) OR private.is_admin_user())
  WITH CHECK (grabbed_by = (SELECT auth.uid()) OR private.is_admin_user());

CREATE OR REPLACE FUNCTION public.claim_project_id(
  p_client_name TEXT,
  p_company_id UUID DEFAULT NULL
)
RETURNS public.project_ids
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id     UUID;
  v_client      TEXT;
  v_name        TEXT;
  v_year_month  TEXT;
  v_next        INTEGER;
  v_row         public.project_ids;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to claim a project ID';
  END IF;

  v_client := btrim(COALESCE(p_client_name, ''));
  IF v_client = '' THEN
    RAISE EXCEPTION 'A client name is required';
  END IF;
  IF length(v_client) > 200 THEN
    RAISE EXCEPTION 'That client name is too long (200 characters maximum)';
  END IF;

  IF p_company_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'That business unit no longer exists';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), pr.email, 'Unknown user')
  INTO v_name
  FROM public.profiles pr
  WHERE pr.id = v_user_id;
  v_name := COALESCE(v_name, 'Unknown user');

  -- Central time, not UTC — see the header note about the month boundary.
  v_year_month := to_char(timezone('America/Chicago', now()), 'YYMM');

  -- Serialize claims within this month so the MAX(seq) read below cannot be stale by the time
  -- the INSERT lands. Released automatically when the transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended('project_ids:' || v_year_month, 0));

  SELECT COALESCE(MAX(pi.seq), 1110) + 1
  INTO v_next
  FROM public.project_ids pi
  WHERE pi.year_month = v_year_month;

  IF v_next > 9999 THEN
    RAISE EXCEPTION 'Every project ID for % has been used (1111-9999)', v_year_month;
  END IF;

  INSERT INTO public.project_ids (
    project_id, year_month, seq, client_name, company_id, grabbed_by, grabbed_by_name
  )
  VALUES (
    v_year_month || v_next::TEXT, v_year_month, v_next, v_client, p_company_id, v_user_id, v_name
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.claim_project_id(TEXT, UUID) IS
  'Atomically allocates the next YYMM project ID for the current Central-time month and '
  'records it against the calling user. The only write path into public.project_ids.';

REVOKE ALL ON FUNCTION public.claim_project_id(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_project_id(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_project_id(TEXT, UUID) TO authenticated;

-- Registers the module so a super admin can switch the section off like any other.
INSERT INTO public.app_modules (module_key, enabled) VALUES ('project_ids', true)
ON CONFLICT (module_key) DO NOTHING;

-- Post-conditions: roll back rather than half-apply (see CLAUDE.md conventions).
DO $post$
DECLARE
  v_secdef   BOOLEAN;
  v_search   TEXT[];
  v_rls      BOOLEAN;
  v_module   INTEGER;
BEGIN
  SELECT p.prosecdef, p.proconfig
  INTO v_secdef, v_search
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'claim_project_id';

  IF v_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'post-condition: claim_project_id must be SECURITY DEFINER';
  END IF;

  -- Postgres stores the empty search_path quoted ('search_path=""'); accept the bare form too
  -- rather than depending on how a given server spells it.
  IF v_search IS NULL OR NOT (v_search && ARRAY['search_path=""', 'search_path=']) THEN
    RAISE EXCEPTION 'post-condition: claim_project_id must pin an empty search_path, got %', v_search;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.claim_project_id(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-condition: authenticated must be able to claim a project ID';
  END IF;

  -- anon inherits anything granted to PUBLIC, so this also catches the default PUBLIC grant
  -- that CREATE FUNCTION hands out.
  IF has_function_privilege('anon', 'public.claim_project_id(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-condition: anon must not be able to claim a project ID';
  END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.project_ids'::regclass;
  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'post-condition: RLS must be enabled on project_ids';
  END IF;

  -- The permanence guarantee, asserted rather than assumed.
  IF has_table_privilege('authenticated', 'public.project_ids', 'DELETE') THEN
    RAISE EXCEPTION 'post-condition: project_ids must never be deletable by authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.project_ids', 'INSERT') THEN
    RAISE EXCEPTION 'post-condition: project_ids must only be written through claim_project_id';
  END IF;
  IF has_table_privilege('anon', 'public.project_ids', 'SELECT') THEN
    RAISE EXCEPTION 'post-condition: the ledger must not be readable while signed out';
  END IF;

  -- Column-scoped UPDATE: the cross-reference is correctable, the number is not.
  IF NOT has_column_privilege('authenticated', 'public.project_ids', 'client_name', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition: client_name must be correctable';
  END IF;
  IF has_column_privilege('authenticated', 'public.project_ids', 'project_id', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition: project_id itself must not be updatable';
  END IF;
  IF has_column_privilege('authenticated', 'public.project_ids', 'grabbed_by', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition: grabbed_by must not be updatable';
  END IF;
  IF has_column_privilege('authenticated', 'public.project_ids', 'grabbed_at', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition: grabbed_at must not be updatable';
  END IF;

  SELECT count(*) INTO v_module FROM public.app_modules WHERE module_key = 'project_ids';
  IF v_module <> 1 THEN
    RAISE EXCEPTION 'post-condition: expected the project_ids module row, found %', v_module;
  END IF;
END
$post$;

COMMIT;
