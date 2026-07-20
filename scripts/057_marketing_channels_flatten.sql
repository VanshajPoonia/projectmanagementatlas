-- Channels no longer belong to a company/section. Previously a channel like
-- "BLOG" existed as two separate rows (one under SRG, one under AGC) purely
-- so the old per-section grid could tell them apart — which company an event
-- belongs to is now decided per-event (see 058_marketing_calendar_companies),
-- not baked into the channel. This also fixes "New channel" needing a
-- company picker at all, which was surfacing as a confusing DB error when
-- the section/company model didn't match what the user was trying to do.

BEGIN;

-- Dedupe: keep the lowest-position row for each channel name, drop the rest
-- (only affects channels that existed under more than one section, e.g. BLOG,
-- BREVO Email — the company-specific ones like "FB - AGC" are untouched).
DELETE FROM public.marketing_channels mc
WHERE id NOT IN (
  SELECT DISTINCT ON (channel) id
  FROM public.marketing_channels
  ORDER BY channel, position, id
);

ALTER TABLE public.marketing_channels DROP CONSTRAINT IF EXISTS marketing_channels_section_check;
DROP INDEX IF EXISTS idx_marketing_channels_section_channel;
ALTER TABLE public.marketing_channels DROP COLUMN IF EXISTS section;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_channels_channel ON public.marketing_channels (lower(channel));

COMMIT;
