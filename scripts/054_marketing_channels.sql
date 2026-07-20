-- Shared, editable list of marketing calendar channels.
-- Previously the channels were hard-coded in the UI; moving them into a table
-- lets admins add new channels that everyone sees and that stay in sync across
-- the sheet, grid, and every user's view.

BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL CHECK (section IN ('SRG', 'AGC', 'BOTH')),
  channel TEXT NOT NULL,   -- stored value written onto marketing_calendar_items.channel
  label TEXT NOT NULL,     -- short display label
  position INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- A channel value is unique within its section (SRG BLOG and AGC BLOG can coexist).
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_channels_section_channel
  ON public.marketing_channels(section, channel);

ALTER TABLE public.marketing_channels ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_channels TO authenticated;

-- Everyone signed in can read the channel list (Kayla views her own board).
DROP POLICY IF EXISTS "Anyone can view marketing channels" ON public.marketing_channels;
CREATE POLICY "Anyone can view marketing channels"
  ON public.marketing_channels FOR SELECT
  TO authenticated
  USING (true);

-- Only admins manage the channel list.
DROP POLICY IF EXISTS "Admins manage marketing channels" ON public.marketing_channels;
CREATE POLICY "Admins manage marketing channels"
  ON public.marketing_channels FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed the previously hard-coded channels (idempotent).
INSERT INTO public.marketing_channels (section, channel, label, position) VALUES
  ('SRG',  'FB - Bobby',   'FB Bobby',  0),
  ('SRG',  'FB - SRG',     'FB SRG',    1),
  ('SRG',  'IG - Bobby',   'IG Bobby',  2),
  ('SRG',  'TT - Bobby',   'TT Bobby',  3),
  ('SRG',  'BLOG',         'Blog',      4),
  ('SRG',  'BREVO Email',  'Brevo',     5),
  ('SRG',  'Eagles',       'Eagles',    6),
  ('BOTH', 'PR Events',    'PR Events', 7),
  ('AGC',  'FB - AGC',     'FB AGC',    8),
  ('AGC',  'IG - AGC',     'IG AGC',    9),
  ('AGC',  'TT - AGC',     'TT AGC',    10),
  ('AGC',  'Advertising',  'Ads',       11),
  ('AGC',  'BLOG',         'Blog',      12),
  ('AGC',  'BREVO Email',  'Brevo',     13),
  ('AGC',  'OTHER',        'Other',     14)
ON CONFLICT (section, channel) DO NOTHING;

COMMIT;
