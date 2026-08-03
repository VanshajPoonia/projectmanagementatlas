-- Appointment booking, phase 2: an unauthenticated visitor picks a slot on a
-- host's capability link, and the write is validated + inserted atomically.
--
-- Mirrors share_links (072) for the link/token shape and
-- update_marketing_calendar_series_atomic (078) for the "validate everything
-- inside one SECURITY DEFINER transaction" approach. The public page itself
-- reads via the service role after validating the token — same pattern as
-- /share/[token] — so no anon SELECT policy is needed on any table here.
--
-- Rate limiting is an append-only attempt log, not a counter row, because a log
-- can be queried for both "attempts on this link" and "attempts from this IP"
-- without a second index scheme. For a single-org internal tool this will never
-- grow large enough to need a cleanup job.
--
-- IMPORTANT: the IP-based half of rate limiting only works if the caller passes
-- a server-computed hash of the REAL client IP. That means the app must never
-- let the browser call check_booking_rate_limit directly — only a Next.js route
-- handler that reads the request's IP itself may call it. A client-supplied
-- "IP" is trivially randomized and defeats the limit entirely.

BEGIN;

-- ---------------------------------------------------------------------------
-- Booking links (capability tokens, one host may mint several)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appointment_booking_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMP WITH TIME ZONE,
  revoked_at   TIMESTAMP WITH TIME ZONE,
  -- Same shape as share_links' token (two UUIDv4s, hyphens stripped): 64 hex
  -- chars, so lib/appointment-booking.ts can reuse isValidShareToken's regex.
  CONSTRAINT appointment_booking_links_token_format CHECK (token ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_appointment_booking_links_host
  ON public.appointment_booking_links(host_user_id);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appointments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_link_id      UUID REFERENCES public.appointment_booking_links(id) ON DELETE SET NULL,
  starts_at            TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at              TIMESTAMP WITH TIME ZONE NOT NULL,
  guest_name           TEXT NOT NULL CHECK (char_length(btrim(guest_name)) BETWEEN 1 AND 200),
  guest_email          TEXT NOT NULL CHECK (guest_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  guest_phone          TEXT,
  note                 TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  status               TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  cancel_token         TEXT UNIQUE CHECK (cancel_token IS NULL OR cancel_token ~ '^[a-f0-9]{64}$'),
  -- Guards the one-time post-booking email step (guest confirmation + host
  -- notification, sent together). No endpoint exists to re-trigger it once
  -- set, so this is the only control the send needs — no separate rate limit.
  confirmation_sent_at TIMESTAMP WITH TIME ZONE,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT appointments_time_order CHECK (ends_at > starts_at)
);

-- The hot query for both the availability read and the RPC's overlap check.
CREATE INDEX IF NOT EXISTS idx_appointments_host_range
  ON public.appointments(host_user_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_appointments_booking_link
  ON public.appointments(booking_link_id)
  WHERE booking_link_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Booking-attempt log (rate limiting)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appointment_booking_attempts (
  id              BIGSERIAL PRIMARY KEY,
  booking_link_id UUID NOT NULL REFERENCES public.appointment_booking_links(id) ON DELETE CASCADE,
  ip_hash         TEXT NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_attempts_link_time
  ON public.appointment_booking_attempts(booking_link_id, created_at);

CREATE INDEX IF NOT EXISTS idx_booking_attempts_ip_time
  ON public.appointment_booking_attempts(ip_hash, created_at);

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

ALTER TABLE public.appointment_booking_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_booking_attempts   ENABLE ROW LEVEL SECURITY;

-- Learned from 080/081: Supabase's ALTER DEFAULT PRIVILEGES grants anon ALL on
-- every new public table. Revoke immediately rather than relying on RLS alone.
REVOKE ALL ON public.appointment_booking_links    FROM anon;
REVOKE ALL ON public.appointments                 FROM anon;
REVOKE ALL ON public.appointment_booking_attempts FROM anon;
-- Nobody reads/writes this table directly, not even the host — only the
-- SECURITY DEFINER functions below touch it (they run as the owning role,
-- which bypasses RLS the same way 074's trigger functions already do).
REVOKE ALL ON public.appointment_booking_attempts FROM authenticated;

GRANT SELECT, INSERT ON public.appointment_booking_links TO authenticated;
-- Mirrors 074's share_links pattern: a link is revoked, never edited or deleted.
GRANT UPDATE (revoked_at) ON public.appointment_booking_links TO authenticated;

-- All writes to appointments happen through book_appointment/cancel_appointment
-- (SECURITY DEFINER). Authenticated only ever reads, for a future "my
-- appointments" list (not built yet — Phase 3).
GRANT SELECT ON public.appointments TO authenticated;

DROP POLICY IF EXISTS "View own booking links" ON public.appointment_booking_links;
CREATE POLICY "View own booking links"
  ON public.appointment_booking_links FOR SELECT
  TO authenticated
  USING (host_user_id = (SELECT auth.uid()) OR private.is_admin_user());

DROP POLICY IF EXISTS "Create own booking links" ON public.appointment_booking_links;
CREATE POLICY "Create own booking links"
  ON public.appointment_booking_links FOR INSERT
  TO authenticated
  WITH CHECK (
    host_user_id = (SELECT auth.uid())
    AND created_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "Revoke own booking links" ON public.appointment_booking_links;
CREATE POLICY "Revoke own booking links"
  ON public.appointment_booking_links FOR UPDATE
  TO authenticated
  USING (host_user_id = (SELECT auth.uid()) OR private.is_admin_user())
  WITH CHECK (
    (host_user_id = (SELECT auth.uid()) OR private.is_admin_user())
    AND revoked_at IS NOT NULL
  );

DROP POLICY IF EXISTS "View own appointments" ON public.appointments;
CREATE POLICY "View own appointments"
  ON public.appointments FOR SELECT
  TO authenticated
  USING (host_user_id = (SELECT auth.uid()) OR private.is_admin_user());

-- ---------------------------------------------------------------------------
-- Token generation (internal only — never exposed as a public RPC)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.generate_booking_secret()
RETURNS TEXT
LANGUAGE sql
AS $function$
  SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$function$;

-- ---------------------------------------------------------------------------
-- Rate limit: append the attempt, then reject if either window is over budget.
-- Deliberately a SEPARATE call from book_appointment (not inlined into its
-- transaction) so the attempt is recorded even when the booking itself later
-- fails validation — a single transaction would roll the log entry back along
-- with the rejected booking, defeating the point of logging it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_booking_rate_limit(
  p_token TEXT,
  p_ip_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_link_id UUID;
  v_link_count INT;
  v_ip_count INT;
BEGIN
  IF p_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid booking link';
  END IF;
  IF NULLIF(btrim(p_ip_hash), '') IS NULL THEN
    RAISE EXCEPTION 'Missing client identifier';
  END IF;

  SELECT id INTO v_link_id
  FROM public.appointment_booking_links
  WHERE token = p_token;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'This booking link is no longer available';
  END IF;

  INSERT INTO public.appointment_booking_attempts (booking_link_id, ip_hash)
  VALUES (v_link_id, p_ip_hash);

  SELECT count(*) INTO v_link_count
  FROM public.appointment_booking_attempts
  WHERE booking_link_id = v_link_id
    AND created_at > NOW() - INTERVAL '10 minutes';

  SELECT count(*) INTO v_ip_count
  FROM public.appointment_booking_attempts
  WHERE ip_hash = p_ip_hash
    AND created_at > NOW() - INTERVAL '10 minutes';

  IF v_link_count > 8 OR v_ip_count > 12 THEN
    RAISE EXCEPTION 'Too many attempts. Please try again in a few minutes.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_booking_rate_limit(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_booking_rate_limit(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- The booking write itself. Every rule that lib/appointment-availability.ts
-- checks client-side for UI feedback is re-checked here, because the caller is
-- unauthenticated and the request is fully forgeable — the client-side check
-- is a convenience, never the authority.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.book_appointment(
  p_token TEXT,
  p_starts_at TIMESTAMP WITH TIME ZONE,
  p_ends_at TIMESTAMP WITH TIME ZONE,
  p_guest_name TEXT,
  p_guest_email TEXT,
  p_guest_phone TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, cancel_token TEXT, starts_at TIMESTAMP WITH TIME ZONE, ends_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_link RECORD;
  v_settings RECORD;
  v_duration_minutes NUMERIC;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_local_date DATE;
  v_weekday INT;
  v_start_minutes INT;
  v_end_minutes INT;
  v_restriction RECORD;
  v_overlap_count INT;
  v_new_id UUID;
  v_cancel_token TEXT;
BEGIN
  IF p_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid booking link';
  END IF;
  IF NULLIF(btrim(p_guest_name), '') IS NULL THEN
    RAISE EXCEPTION 'Your name is required';
  END IF;
  IF p_guest_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'A valid email is required';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'The end time must be after the start time';
  END IF;
  IF p_starts_at <= NOW() THEN
    RAISE EXCEPTION 'That time has already passed';
  END IF;

  SELECT * INTO v_link
  FROM public.appointment_booking_links
  WHERE token = p_token
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This booking link is no longer available';
  END IF;

  SELECT * INTO v_settings
  FROM public.appointment_settings
  WHERE user_id = v_link.host_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This host has not configured booking preferences yet';
  END IF;

  -- Serialize concurrent bookings for the SAME host: two visitors racing for
  -- the same slot would otherwise both read overlap_count=0 under the default
  -- READ COMMITTED isolation and both insert. This blocks a second concurrent
  -- call for this host until the first one's transaction ends (commit or
  -- rollback), and is released automatically then — no unlock call needed.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_link.host_user_id::text, 0));

  -- Restrictions and preferences are wall-clock, so convert the requested
  -- instant into the host's local time before comparing against either.
  v_local_start := timezone(v_settings.timezone, p_starts_at);
  v_local_end   := timezone(v_settings.timezone, p_ends_at);

  IF v_local_start::date IS DISTINCT FROM v_local_end::date THEN
    RAISE EXCEPTION 'Appointments cannot span midnight';
  END IF;

  v_local_date    := v_local_start::date;
  v_weekday       := EXTRACT(DOW FROM v_local_date)::INT;
  v_start_minutes := EXTRACT(HOUR FROM v_local_start)::INT * 60 + EXTRACT(MINUTE FROM v_local_start)::INT;
  v_end_minutes   := EXTRACT(HOUR FROM v_local_end)::INT   * 60 + EXTRACT(MINUTE FROM v_local_end)::INT;

  v_duration_minutes := EXTRACT(EPOCH FROM (p_ends_at - p_starts_at)) / 60;

  IF v_duration_minutes < v_settings.min_duration_minutes THEN
    RAISE EXCEPTION 'That appointment is shorter than the minimum allowed';
  END IF;
  IF v_settings.max_duration_minutes IS NOT NULL AND v_duration_minutes > v_settings.max_duration_minutes THEN
    RAISE EXCEPTION 'That appointment is longer than the maximum allowed';
  END IF;

  IF NOT v_settings.allow_same_day AND v_local_date = (timezone(v_settings.timezone, NOW()))::date THEN
    RAISE EXCEPTION 'Same-day bookings are not available';
  END IF;
  IF p_starts_at - NOW() < (v_settings.required_lead_time_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'That time does not allow enough advance notice';
  END IF;

  -- A restriction whose reason is never surfaced here: a public visitor has no
  -- business learning WHY a host is unavailable, only that they are.
  FOR v_restriction IN
    SELECT * FROM public.appointment_restrictions
    WHERE user_id = v_link.host_user_id
      AND starts_on <= v_local_date
      AND ends_on >= v_local_date
      AND (array_length(weekdays, 1) IS NULL OR v_weekday = ANY(weekdays))
  LOOP
    IF v_restriction.is_all_day THEN
      RAISE EXCEPTION 'That time is not available';
    END IF;

    IF v_restriction.starts_at_time IS NOT NULL AND v_restriction.ends_at_time IS NOT NULL THEN
      IF (EXTRACT(HOUR FROM v_restriction.starts_at_time) * 60 + EXTRACT(MINUTE FROM v_restriction.starts_at_time)) < v_end_minutes
         AND (EXTRACT(HOUR FROM v_restriction.ends_at_time) * 60 + EXTRACT(MINUTE FROM v_restriction.ends_at_time)) > v_start_minutes
      THEN
        RAISE EXCEPTION 'That time is not available';
      END IF;
    END IF;
  END LOOP;

  -- Table-aliased and qualified deliberately: RETURNS TABLE(..., starts_at,
  -- ends_at) above implicitly declares those as PL/pgSQL variables in this
  -- function's scope, so an unqualified `starts_at`/`ends_at` here is
  -- ambiguous between that variable and public.appointments' own columns.
  SELECT count(*) INTO v_overlap_count
  FROM public.appointments a
  WHERE a.host_user_id = v_link.host_user_id
    AND a.status = 'confirmed'
    AND a.starts_at < p_ends_at
    AND a.ends_at > p_starts_at;

  IF v_overlap_count > 0 THEN
    IF NOT v_settings.allow_overlaps THEN
      RAISE EXCEPTION 'That time was just booked. Please choose another.';
    ELSIF v_settings.max_overlaps IS NOT NULL AND v_overlap_count >= v_settings.max_overlaps THEN
      RAISE EXCEPTION 'That time is fully booked. Please choose another.';
    END IF;
  END IF;

  v_cancel_token := private.generate_booking_secret();

  INSERT INTO public.appointments (
    host_user_id, booking_link_id, starts_at, ends_at,
    guest_name, guest_email, guest_phone, note, cancel_token
  ) VALUES (
    v_link.host_user_id, v_link.id, p_starts_at, p_ends_at,
    btrim(p_guest_name), lower(btrim(p_guest_email)), NULLIF(btrim(p_guest_phone), ''), NULLIF(btrim(p_note), ''),
    v_cancel_token
  )
  RETURNING appointments.id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_cancel_token, p_starts_at, p_ends_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.book_appointment(
    TEXT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT, TEXT
  ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_appointment(
    TEXT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT, TEXT
  ) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cancellation. cancel_token is itself an unguessable 256-bit capability (same
-- trust model share_links uses for its token), so this needs no separate rate
-- limit — only someone holding the token from their confirmation email can
-- ever call this successfully.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_appointment(p_cancel_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  IF p_cancel_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid cancellation link';
  END IF;

  UPDATE public.appointments
  SET status = 'cancelled'
  WHERE cancel_token = p_cancel_token
    AND status = 'confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This appointment was already cancelled or could not be found';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_appointment(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_appointment(TEXT) TO anon, authenticated;

COMMIT;
