-- Appointment booking rules, phase 1: a host's own preferences and the windows
-- during which they will not take appointments.
--
-- Restrictions are stored as RULES and evaluated, never expanded into one row per
-- occurrence. This is deliberately unlike the marketing calendar's recurrence
-- (053/058), which materializes one marketing_calendar_items row per date: a
-- restriction has no per-occurrence identity, nothing is ever attached to a single
-- day of it, and a rule stays correct when its date range is edited.
--
-- weekdays carries both shapes the source design shows in one column:
--   '{}'        -> a one-time restriction covering every day in [starts_on, ends_on]
--   '{3,4,5,6}' -> repeats on Wed/Thu/Fri/Sat within that range
--
-- Times are WALL CLOCK (date + time, no zone) because a restriction means "not on
-- Wednesday mornings" regardless of offset. appointment_settings.timezone is what
-- converts them to absolute instants when a booking is checked in phase 2. Storing
-- these as timestamptz would silently shift every window across a DST boundary.
--
-- Phase 1 has no public surface: booking links and the anonymous write path land in
-- a later migration, so nothing here is reachable without a session.

BEGIN;

-- ---------------------------------------------------------------------------
-- Per-host booking preferences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appointment_settings (
  user_id                   UUID PRIMARY KEY
                              REFERENCES public.profiles(id) ON DELETE CASCADE,
  min_duration_minutes      INTEGER NOT NULL DEFAULT 30
                              CHECK (min_duration_minutes BETWEEN 5 AND 1440),
  -- NULL is the source design's "None": no maximum.
  max_duration_minutes      INTEGER
                              CHECK (max_duration_minutes BETWEEN 5 AND 1440),
  required_lead_time_hours  INTEGER NOT NULL DEFAULT 0
                              CHECK (required_lead_time_hours BETWEEN 0 AND 720),
  suggested_lead_time_hours INTEGER
                              CHECK (suggested_lead_time_hours BETWEEN 0 AND 720),
  allow_same_day            BOOLEAN NOT NULL DEFAULT TRUE,
  allow_overlaps            BOOLEAN NOT NULL DEFAULT FALSE,
  -- NULL is "No overlap limit"; only meaningful when allow_overlaps is true.
  max_overlaps              INTEGER
                              CHECK (max_overlaps BETWEEN 1 AND 100),
  timezone                  TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT appointment_settings_duration_order
    CHECK (max_duration_minutes IS NULL OR max_duration_minutes >= min_duration_minutes)
);

-- ---------------------------------------------------------------------------
-- Restriction windows
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appointment_restrictions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason         TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  starts_on      DATE NOT NULL,
  ends_on        DATE NOT NULL,
  is_all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at_time TIME,
  ends_at_time   TIME,
  weekdays       SMALLINT[] NOT NULL DEFAULT '{}',
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT appointment_restrictions_date_order
    CHECK (ends_on >= starts_on),
  -- A timed restriction needs both bounds; an all-day one needs neither.
  CONSTRAINT appointment_restrictions_times_present
    CHECK (is_all_day OR (starts_at_time IS NOT NULL AND ends_at_time IS NOT NULL)),
  CONSTRAINT appointment_restrictions_time_order
    CHECK (is_all_day OR ends_at_time > starts_at_time),
  -- Only real weekday numbers. '{}' is deliberately allowed — that is the one-time
  -- shape. The NULL-element test is not redundant: a NULL inside the array makes the
  -- containment expression itself NULL, and a CHECK treats NULL as passing.
  CONSTRAINT appointment_restrictions_weekdays_valid
    CHECK (
      weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
      AND array_position(weekdays, NULL) IS NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_appointment_restrictions_user
  ON public.appointment_restrictions(user_id);

-- Availability is always asked as "what blocks this host between these dates".
CREATE INDEX IF NOT EXISTS idx_appointment_restrictions_user_range
  ON public.appointment_restrictions(user_id, starts_on, ends_on);

CREATE INDEX IF NOT EXISTS idx_appointment_restrictions_created_by
  ON public.appointment_restrictions(created_by)
  WHERE created_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

ALTER TABLE public.appointment_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_restrictions  ENABLE ROW LEVEL SECURITY;

-- New public-schema tables are not guaranteed to be exposed to the Data API
-- automatically (see 076), so grant the authenticated role explicitly. anon is
-- never granted anything: the phase-2 public booking page reads via the service
-- role after validating a token, exactly as /share/[token] does.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_settings     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_restrictions TO authenticated;

DROP POLICY IF EXISTS "View own appointment settings" ON public.appointment_settings;
CREATE POLICY "View own appointment settings"
  ON public.appointment_settings FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_admin_user());

DROP POLICY IF EXISTS "Create own appointment settings" ON public.appointment_settings;
CREATE POLICY "Create own appointment settings"
  ON public.appointment_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Update own appointment settings" ON public.appointment_settings;
CREATE POLICY "Update own appointment settings"
  ON public.appointment_settings FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Delete own appointment settings" ON public.appointment_settings;
CREATE POLICY "Delete own appointment settings"
  ON public.appointment_settings FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Admins may review a host's restrictions (the same oversight chokepoint used by
-- share_links) but only the host may write them — an admin silently editing when
-- someone is bookable would be invisible to that person.
DROP POLICY IF EXISTS "View own appointment restrictions" ON public.appointment_restrictions;
CREATE POLICY "View own appointment restrictions"
  ON public.appointment_restrictions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_admin_user());

DROP POLICY IF EXISTS "Create own appointment restrictions" ON public.appointment_restrictions;
CREATE POLICY "Create own appointment restrictions"
  ON public.appointment_restrictions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Update own appointment restrictions" ON public.appointment_restrictions;
CREATE POLICY "Update own appointment restrictions"
  ON public.appointment_restrictions FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Delete own appointment restrictions" ON public.appointment_restrictions;
CREATE POLICY "Delete own appointment restrictions"
  ON public.appointment_restrictions FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Module registration
-- ---------------------------------------------------------------------------

-- Ships disabled: phase 1 has no UI yet, and a super admin should switch this on
-- deliberately once the screens land. Every other module row seeded by 066 is
-- enabled=true, so this is the one intentional exception.
INSERT INTO public.app_modules (module_key, enabled, config)
VALUES ('appointments', FALSE, '{}'::jsonb)
ON CONFLICT (module_key) DO NOTHING;

COMMIT;
