-- Tighten authenticated's table grants on the booking tables 082 created.
--
-- 082 granted authenticated exactly SELECT/INSERT plus a narrow revoked_at-only
-- UPDATE on appointment_booking_links, and SELECT-only on appointments — but
-- never revoked the broader UPDATE/DELETE/TRUNCATE that Supabase's default
-- privileges grant automatically. Nothing was actually reachable: RLS has no
-- permissive policy for DELETE or a blanket UPDATE on either table, so those
-- grants matched zero rows. But 074 already established the correct pattern
-- for exactly this table shape (share_links) — REVOKE the broad grant from
-- authenticated too, not just anon — and 082 should have followed it instead
-- of relying on RLS alone to cover a gap the grant itself should close.

BEGIN;

REVOKE UPDATE, DELETE, TRUNCATE ON public.appointment_booking_links FROM authenticated;
GRANT UPDATE (revoked_at) ON public.appointment_booking_links TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.appointments FROM authenticated;

COMMIT;
