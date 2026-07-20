-- Replace marketing_calendar_items.section (SRG/AGC/BOTH enum) with a proper
-- many-to-many relation to companies, so an event can belong to any set of
-- companies instead of being forced into a single-value enum. This also
-- retires "BOTH" as a special value — shared content is now just an event
-- tagged with both real companies.
--
-- Also adds recurrence_group_id so editing one instance of a recurring
-- series can update every instance in that series (previously each
-- recurrence date was an independent, unlinked row).

BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_calendar_item_companies (
  item_id UUID NOT NULL REFERENCES public.marketing_calendar_items(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_mcic_company ON public.marketing_calendar_item_companies (company_id);
CREATE INDEX IF NOT EXISTS idx_mcic_item ON public.marketing_calendar_item_companies (item_id);

ALTER TABLE public.marketing_calendar_item_companies ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_calendar_item_companies TO authenticated;

-- Visibility/write access mirrors the parent item: assigned user or admin.
DROP POLICY IF EXISTS "View item companies for visible items" ON public.marketing_calendar_item_companies;
CREATE POLICY "View item companies for visible items"
  ON public.marketing_calendar_item_companies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_calendar_items i
      WHERE i.id = item_id AND (i.assigned_to = auth.uid() OR private.is_admin_user())
    )
  );

DROP POLICY IF EXISTS "Manage item companies for own items" ON public.marketing_calendar_item_companies;
CREATE POLICY "Manage item companies for own items"
  ON public.marketing_calendar_item_companies FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_calendar_items i
      WHERE i.id = item_id AND (i.assigned_to = auth.uid() OR private.is_admin_user())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketing_calendar_items i
      WHERE i.id = item_id AND (i.assigned_to = auth.uid() OR private.is_admin_user())
    )
  );

-- Backfill from the existing section column.
INSERT INTO public.marketing_calendar_item_companies (item_id, company_id)
SELECT i.id, c.id
FROM public.marketing_calendar_items i
JOIN public.companies c ON c.code = i.section
WHERE i.section IN ('SRG', 'AGC')
ON CONFLICT DO NOTHING;

INSERT INTO public.marketing_calendar_item_companies (item_id, company_id)
SELECT i.id, c.id
FROM public.marketing_calendar_items i
JOIN public.companies c ON c.code IN ('SRG', 'AGC')
WHERE i.section = 'BOTH'
ON CONFLICT DO NOTHING;

-- Drop the now-redundant section column.
DROP INDEX IF EXISTS idx_marketing_calendar_items_section;
ALTER TABLE public.marketing_calendar_items DROP CONSTRAINT IF EXISTS marketing_calendar_items_section_check;
ALTER TABLE public.marketing_calendar_items DROP COLUMN IF EXISTS section;

-- Link recurring-series instances so editing one can update all of them.
ALTER TABLE public.marketing_calendar_items ADD COLUMN IF NOT EXISTS recurrence_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_mci_recurrence_group ON public.marketing_calendar_items (recurrence_group_id);

COMMIT;
