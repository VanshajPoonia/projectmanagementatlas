-- 104_crm_integrity_fixes.sql
--
-- Three defects in 103, all found by driving the module the way its own header says it must
-- survive being driven: "however the row was moved — import, psql, a future automation".
--
-- 1. ⚠️ THE CARRIERS LEAKED, AND A LATER TRANSITION INHERITED THEM. 103 registered the UPDATE
--    trigger as BEFORE UPDATE **OF status**, so an UPDATE that set status_change_reason /
--    status_change_note without naming `status` in its SET list never fired the trigger at all
--    and the carriers were simply stored. The second hole was inside the function: when the
--    status was named but unchanged, it took an early RETURN NEW that skipped the blanking.
--    Either way the carriers stopped being "always NULL at rest", and the next real transition
--    read them and stamped that stale disposition onto the interval it opened. Reproduced
--    against the dev sandbox before this fix was written: an order moved to Won came back
--    carrying reason "Waiting on documentation" and note "no-op note", neither of which the
--    caller supplied. That is the audit trail asserting something that never happened, which
--    is worse than having no audit trail.
--
--    Fixed by registering the trigger on **every** UPDATE (so a carrier-only write cannot slip
--    past) and clearing the carriers on every path out of the function, the no-op path
--    included. The carriers describe one transition; they must not outlive it.
--
-- 2. REQUIRES_REASON WAS UI-DEEP. 103 seeded crm_statuses.requires_reason and the Status
--    Control screen honours it, but nothing below the component did — a cancel written from
--    psql, an import or a future automation recorded no reason and no report could tell. The
--    module's stated position is that a rule the application is trusted to keep is a rule that
--    is broken the first time any other path forgets, so it is enforced here now.
--
-- 3. THE REFERENCE MINTERS RACED. claim_crm_client_ref/claim_crm_order_no took
--    pg_advisory_xact_lock, read MAX(...) and returned a string. The lock is released when the
--    RPC's transaction ends, which is *before* the caller's INSERT lands in its own separate
--    request — so two intakes submitted together both read the same MAX, were both handed the
--    same reference, and the second INSERT died on the UNIQUE constraint with a raw 23505.
--    The comment in crm-intake-form.tsx claimed the opposite. Migration 090 got this right by
--    doing the INSERT *inside* the locked function; that shape does not fit here (the client
--    row is assembled from a dozen form fields), so these use a real SEQUENCE instead, which
--    is race-free by construction and needs no lock. Gaps from a rolled-back intake are fine:
--    a reference is an identifier, not a count.
--
-- Corrective and self-verifying. It replaces two functions and one trigger registration that
-- 103 itself created, adds two sequences, and touches no other table, policy or grant.
-- Paired rollback: scripts/rollback/104_revert.sql

BEGIN;

-- ── 3. Race-free reference minting ───────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.crm_client_ref_seq AS BIGINT START WITH 10001;
CREATE SEQUENCE IF NOT EXISTS public.crm_order_no_seq   AS BIGINT START WITH 1001;

-- Advance past anything 103's MAX()-scanning version already handed out, so the switch cannot
-- reissue a reference that is already on a row.
SELECT setval(
  'public.crm_client_ref_seq',
  GREATEST(10000, COALESCE((
    SELECT MAX(NULLIF(regexp_replace(client_ref, '\D', '', 'g'), '')::BIGINT)
      FROM public.crm_clients WHERE client_ref ~ '^C-\d+$'
  ), 10000)),
  TRUE
);

SELECT setval(
  'public.crm_order_no_seq',
  GREATEST(1000, COALESCE((
    SELECT MAX(split_part(order_no, '-', 3)::BIGINT)
      FROM public.crm_orders WHERE order_no ~ '^ORD-\d{6}-\d+$'
  ), 1000)),
  TRUE
);

REVOKE ALL ON SEQUENCE public.crm_client_ref_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.crm_order_no_seq   FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER, so nextval runs as the owner and `authenticated` needs no grant on the
-- sequence itself — the function stays the only way to draw a number.
CREATE OR REPLACE FUNCTION public.claim_crm_client_ref()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'not authorised to create clients' USING ERRCODE = '42501';
  END IF;
  RETURN 'C-' || nextval('public.crm_client_ref_seq')::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_crm_client_ref() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_crm_client_ref() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_crm_order_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'not authorised to create orders' USING ERRCODE = '42501';
  END IF;
  -- ORD-YYMMDD-#### still reads as the mockup's ORD-260813-1187. The counter no longer resets
  -- each day, which is deliberate: a per-day counter is exactly the MAX()-scan that raced.
  RETURN 'ORD-' || to_char(NOW(), 'YYMMDD') || '-' || nextval('public.crm_order_no_seq')::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_crm_order_no() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_crm_order_no() TO authenticated;

-- ── 1 + 2. The transition trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.crm_record_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_terminal BOOLEAN;
  v_requires BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_WHEN = 'BEFORE' THEN
      -- An order can be created already closed (backfilled or imported work).
      SELECT is_terminal INTO v_terminal FROM public.crm_statuses WHERE key = NEW.status;
      IF COALESCE(v_terminal, FALSE) AND NEW.closed_at IS NULL THEN
        NEW.closed_at := NEW.opened_at;
      END IF;
      RETURN NEW;
    END IF;

    INSERT INTO public.crm_order_status_history (order_id, status, entered_at, changed_by, reason, note)
    VALUES (NEW.id, NEW.status, NEW.opened_at, COALESCE(NEW.created_by, auth.uid()),
            NEW.status_change_reason, NEW.status_change_note);
    -- AFTER trigger: NEW is not writable here, so the carriers are cleared by a direct UPDATE.
    -- That UPDATE re-enters this function on its BEFORE UPDATE registration, finds the status
    -- unchanged, and returns immediately — one comparison, no recursion.
    UPDATE public.crm_orders
       SET status_change_reason = NULL, status_change_note = NULL
     WHERE id = NEW.id
       AND (status_change_reason IS NOT NULL OR status_change_note IS NOT NULL);
    RETURN NULL;
  END IF;

  -- ⚠️ The carriers describe THIS transition and nothing else. They are cleared on every path
  -- out of this function, the no-op path included: 103 returned early here without blanking
  -- them, and the next real transition then inherited a disposition nobody had given it.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.status_change_reason := NULL;
    NEW.status_change_note   := NULL;
    RETURN NEW;
  END IF;

  SELECT is_terminal, requires_reason INTO v_terminal, v_requires
    FROM public.crm_statuses WHERE key = NEW.status;

  -- A losing transition must say why, whatever wrote it. The UI already asks; this is what
  -- makes the answer non-optional for an import, psql, or a later automation.
  IF COALESCE(v_requires, FALSE) AND COALESCE(btrim(NEW.status_change_note), '') = '' THEN
    RAISE EXCEPTION 'moving an order to "%" requires a reason to be recorded', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Close the interval being left. Exactly one open row per order
  -- (idx_crm_status_history_one_open), so this cannot close the wrong one.
  UPDATE public.crm_order_status_history
     SET exited_at = NOW()
   WHERE order_id = NEW.id AND exited_at IS NULL;

  INSERT INTO public.crm_order_status_history (order_id, status, entered_at, changed_by, reason, note)
  VALUES (NEW.id, NEW.status, NOW(), auth.uid(), NEW.status_change_reason, NEW.status_change_note);

  NEW.status_change_reason := NULL;
  NEW.status_change_note   := NULL;

  -- Reopening clears closed_at, so an order that comes back out of Won/Closed stops counting
  -- as closed instead of permanently skewing "average days to close".
  NEW.closed_at := CASE WHEN COALESCE(v_terminal, FALSE) THEN NOW() ELSE NULL END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ⚠️ Every UPDATE, not just one naming `status`. The OF-clause was the first half of defect 1:
-- an UPDATE that set only the carriers never reached the function, so nothing blanked them.
DROP TRIGGER IF EXISTS crm_orders_status_history_upd ON public.crm_orders;
CREATE TRIGGER crm_orders_status_history_upd
  BEFORE UPDATE ON public.crm_orders
  FOR EACH ROW EXECUTE FUNCTION private.crm_record_status_transition();

-- ── Post-conditions ──────────────────────────────────────────────────────────────────
-- These are the three probes that reproduced the defects, run inside the transaction so a
-- regression rolls the migration back instead of half-applying it.
DO $post$
DECLARE
  v_client UUID;
  v_order  UUID;
  v_reason TEXT;
  v_note   TEXT;
  v_ref_a  TEXT;
  v_ref_b  TEXT;
  v_raised BOOLEAN := FALSE;
BEGIN
  -- Sequences hand out distinct values without a lock.
  v_ref_a := 'C-' || nextval('public.crm_client_ref_seq')::TEXT;
  v_ref_b := 'C-' || nextval('public.crm_client_ref_seq')::TEXT;
  IF v_ref_a = v_ref_b THEN
    RAISE EXCEPTION '104 post-condition: the client reference sequence repeated itself';
  END IF;

  INSERT INTO public.crm_clients (company_name, client_type)
  VALUES ('__104_selftest__', 'business') RETURNING id INTO v_client;
  INSERT INTO public.crm_orders (client_id, status)
  VALUES (v_client, 'new') RETURNING id INTO v_order;

  -- Defect 1a: a carrier-only UPDATE must not persist.
  UPDATE public.crm_orders
     SET status_change_reason = 'Waiting on customer', status_change_note = 'stale note'
   WHERE id = v_order;
  SELECT status_change_reason, status_change_note INTO v_reason, v_note
    FROM public.crm_orders WHERE id = v_order;
  IF v_reason IS NOT NULL OR v_note IS NOT NULL THEN
    RAISE EXCEPTION '104 post-condition: a carrier-only UPDATE left % / % at rest', v_reason, v_note;
  END IF;

  -- Defect 1b: an UPDATE naming status without changing it must not persist them either.
  UPDATE public.crm_orders
     SET status = 'new', status_change_reason = 'Waiting on documentation', status_change_note = 'no-op'
   WHERE id = v_order;
  SELECT status_change_reason, status_change_note INTO v_reason, v_note
    FROM public.crm_orders WHERE id = v_order;
  IF v_reason IS NOT NULL OR v_note IS NOT NULL THEN
    RAISE EXCEPTION '104 post-condition: a no-op status UPDATE left % / % at rest', v_reason, v_note;
  END IF;

  -- Defect 1c: the transition that follows must not inherit either of them.
  UPDATE public.crm_orders SET status = 'won' WHERE id = v_order;
  IF EXISTS (
    SELECT 1 FROM public.crm_order_status_history
     WHERE order_id = v_order AND status = 'won' AND (reason IS NOT NULL OR note IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '104 post-condition: a later transition inherited a stale disposition';
  END IF;

  -- Defect 2: a status marked requires_reason must refuse a transition with no reason.
  BEGIN
    UPDATE public.crm_orders SET status = 'cancel' WHERE id = v_order;
  EXCEPTION WHEN check_violation THEN
    v_raised := TRUE;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '104 post-condition: cancel must require a reason';
  END IF;

  -- ...and must accept one that is supplied.
  UPDATE public.crm_orders
     SET status = 'cancel', status_change_reason = 'Waiting on customer',
         status_change_note = 'client went elsewhere'
   WHERE id = v_order;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_order_status_history
     WHERE order_id = v_order AND status = 'cancel' AND note = 'client went elsewhere'
  ) THEN
    RAISE EXCEPTION '104 post-condition: a supplied reason must reach the interval';
  END IF;

  DELETE FROM public.crm_clients WHERE id = v_client;

  RAISE NOTICE '104 OK — carriers cannot leak, a losing move must say why, references cannot collide';
END
$post$;

COMMIT;
