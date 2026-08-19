-- Revert 103_crm_core.sql
--
-- ⚠️ THIS DESTROYS EVERY CRM RECORD: clients, contacts, orders, notes, documents, and the
-- entire order status history. The history is the one part that cannot be reconstructed from
-- anywhere else - it is the only record of when each order entered and left each status, so
-- every cycle-time and bottleneck report ever produced becomes unreproducible.
--
-- If the intent is "roll back the code, keep the data", dump first:
--   pg_dump --data-only \
--     -t public.crm_clients -t public.crm_contacts -t public.crm_orders \
--     -t public.crm_order_status_history -t public.crm_notes -t public.crm_documents \
--     -t public.crm_statuses "$POSTGRES_URL_NON_POOLING" > crm-backup.sql
--
-- Order matters: triggers before functions, children before parents.

BEGIN;

-- All three status triggers share one function, so every one of them has to go before the
-- function can be dropped. Missing one makes the DROP FUNCTION fail with a dependency error
-- rather than silently half-reverting, which is how this list was found to be incomplete.
DROP TRIGGER IF EXISTS crm_notes_touch_client        ON public.crm_notes;
DROP TRIGGER IF EXISTS crm_orders_touch_client       ON public.crm_orders;
DROP TRIGGER IF EXISTS crm_orders_status_history     ON public.crm_orders;
DROP TRIGGER IF EXISTS crm_orders_status_history_new ON public.crm_orders;
DROP TRIGGER IF EXISTS crm_orders_status_history_ins ON public.crm_orders;
DROP TRIGGER IF EXISTS crm_orders_status_history_upd ON public.crm_orders;

DROP FUNCTION IF EXISTS private.crm_record_status_transition();
DROP FUNCTION IF EXISTS private.crm_touch_client();
DROP FUNCTION IF EXISTS public.claim_crm_order_no();
DROP FUNCTION IF EXISTS public.claim_crm_client_ref();

DROP TABLE IF EXISTS public.crm_documents;
DROP TABLE IF EXISTS public.crm_notes;
DROP TABLE IF EXISTS public.crm_order_status_history;
DROP TABLE IF EXISTS public.crm_orders;
DROP TABLE IF EXISTS public.crm_contacts;
DROP TABLE IF EXISTS public.crm_clients;
DROP TABLE IF EXISTS public.crm_statuses;

DELETE FROM public.app_modules WHERE module_key = 'crm';

DELETE FROM public.applied_migrations WHERE filename = '103_crm_core.sql';

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name LIKE 'crm\_%') THEN
    RAISE EXCEPTION '103 revert: a crm_* table survived the rollback';
  END IF;
  RAISE NOTICE '103 reverted - crm schema removed';
END
$post$;

COMMIT;
