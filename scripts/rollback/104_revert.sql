-- Revert 104_crm_integrity_fixes.sql — back to 103's behaviour.
--
-- ⚠️ This deliberately restores three defects. Only run it if 104 itself is causing a problem
-- worse than the ones it fixes, which is unlikely: after this the status-change carriers can
-- persist at rest and a later transition can inherit a disposition it was never given, a
-- cancel can be recorded with no reason, and two concurrent intakes can be handed the same
-- reference. Reproduce with scripts/probe-carriers.mjs.
--
-- The sequences are dropped last and only if nothing else came to depend on them. Any
-- reference already handed out stays on its row; 104's setval means re-applying it will skip
-- past those numbers rather than reissue them.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_crm_client_ref()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'not authorised to create clients' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_client_ref'));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(client_ref, '\D', '', 'g'), '')::INTEGER), 10000) + 1
    INTO v_next FROM public.crm_clients WHERE client_ref ~ '^C-\d+$';
  RETURN 'C-' || v_next::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_crm_order_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_seq    INTEGER;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'not authorised to create orders' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_order_no'));
  v_prefix := 'ORD-' || to_char(NOW(), 'YYMMDD');
  SELECT COALESCE(MAX(split_part(order_no, '-', 3)::INTEGER), 1000) + 1
    INTO v_seq FROM public.crm_orders WHERE order_no LIKE v_prefix || '-%';
  RETURN v_prefix || '-' || v_seq::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION private.crm_record_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_terminal BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_WHEN = 'BEFORE' THEN
      SELECT is_terminal INTO v_terminal FROM public.crm_statuses WHERE key = NEW.status;
      IF COALESCE(v_terminal, FALSE) AND NEW.closed_at IS NULL THEN
        NEW.closed_at := NEW.opened_at;
      END IF;
      RETURN NEW;
    END IF;

    INSERT INTO public.crm_order_status_history (order_id, status, entered_at, changed_by, reason, note)
    VALUES (NEW.id, NEW.status, NEW.opened_at, COALESCE(NEW.created_by, auth.uid()),
            NEW.status_change_reason, NEW.status_change_note);
    UPDATE public.crm_orders
       SET status_change_reason = NULL, status_change_note = NULL
     WHERE id = NEW.id
       AND (status_change_reason IS NOT NULL OR status_change_note IS NOT NULL);
    RETURN NULL;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE public.crm_order_status_history
     SET exited_at = NOW()
   WHERE order_id = NEW.id AND exited_at IS NULL;

  INSERT INTO public.crm_order_status_history (order_id, status, entered_at, changed_by, reason, note)
  VALUES (NEW.id, NEW.status, NOW(), auth.uid(), NEW.status_change_reason, NEW.status_change_note);

  NEW.status_change_reason := NULL;
  NEW.status_change_note   := NULL;

  SELECT is_terminal INTO v_terminal FROM public.crm_statuses WHERE key = NEW.status;
  NEW.closed_at := CASE WHEN COALESCE(v_terminal, FALSE) THEN NOW() ELSE NULL END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_orders_status_history_upd ON public.crm_orders;
CREATE TRIGGER crm_orders_status_history_upd
  BEFORE UPDATE OF status ON public.crm_orders
  FOR EACH ROW EXECUTE FUNCTION private.crm_record_status_transition();

DROP SEQUENCE IF EXISTS public.crm_client_ref_seq;
DROP SEQUENCE IF EXISTS public.crm_order_no_seq;

DELETE FROM public.applied_migrations WHERE filename = '104_crm_integrity_fixes.sql';

COMMIT;
