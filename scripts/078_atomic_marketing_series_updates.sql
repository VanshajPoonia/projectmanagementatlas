-- Update every row in a recurring marketing series in one transaction.
-- The previous client implementation sent one request per date/channel, so a
-- large series could be left half-shifted when only some requests succeeded.
-- SECURITY INVOKER keeps the existing item/company RLS policies in force.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_marketing_calendar_series_atomic(
  p_recurrence_group_id UUID,
  p_updates JSONB,
  p_content TEXT,
  p_is_highlighted BOOLEAN,
  p_company_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_expected_count INTEGER;
  v_updated_count INTEGER;
  v_company_count INTEGER;
  v_inserted_company_count INTEGER;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_recurrence_group_id IS NULL THEN
    RAISE EXCEPTION 'A recurrence group is required';
  END IF;

  IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'Series updates must be a non-empty array';
  END IF;

  IF NULLIF(btrim(p_content), '') IS NULL THEN
    RAISE EXCEPTION 'Event content is required';
  END IF;

  SELECT count(DISTINCT company_id)
  INTO v_company_count
  FROM unnest(COALESCE(p_company_ids, ARRAY[]::UUID[]))
    AS company_row(company_id);

  IF v_company_count = 0 THEN
    RAISE EXCEPTION 'At least one company is required';
  END IF;

  SELECT count(*)
  INTO v_expected_count
  FROM public.marketing_calendar_items
  WHERE recurrence_group_id = p_recurrence_group_id;

  IF v_expected_count = 0 THEN
    RAISE EXCEPTION 'Recurring series not found or not accessible';
  END IF;

  IF v_expected_count <> jsonb_array_length(p_updates) THEN
    RAISE EXCEPTION
      'Series changed while editing: expected % rows, received %',
      v_expected_count,
      jsonb_array_length(p_updates);
  END IF;

  IF (
    SELECT count(DISTINCT update_row.id)
    FROM jsonb_to_recordset(p_updates) AS update_row(
      id UUID,
      date DATE,
      day_label TEXT,
      channel TEXT
    )
  ) <> v_expected_count THEN
    RAISE EXCEPTION 'Every series row must appear exactly once';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_updates) AS update_row(
      id UUID,
      date DATE,
      day_label TEXT,
      channel TEXT
    )
    LEFT JOIN public.marketing_calendar_items item
      ON item.id = update_row.id
      AND item.recurrence_group_id = p_recurrence_group_id
    WHERE item.id IS NULL
      OR NULLIF(btrim(update_row.channel), '') IS NULL
      OR update_row.day_label IS DISTINCT FROM (
        CASE extract(dow FROM update_row.date)::INTEGER
          WHEN 0 THEN 'SUN'
          WHEN 1 THEN 'MON'
          WHEN 2 THEN 'TUE'
          WHEN 3 THEN 'WED'
          WHEN 4 THEN 'THU'
          WHEN 5 THEN 'FRI'
          WHEN 6 THEN 'SAT'
        END
      )
  ) THEN
    RAISE EXCEPTION 'A series update contains an invalid row';
  END IF;

  UPDATE public.marketing_calendar_items AS item
  SET
    date = update_row.date,
    day_label = update_row.day_label,
    channel = btrim(update_row.channel),
    content = btrim(p_content),
    is_highlighted = p_is_highlighted,
    updated_at = NOW()
  FROM jsonb_to_recordset(p_updates) AS update_row(
    id UUID,
    date DATE,
    day_label TEXT,
    channel TEXT
  )
  WHERE item.id = update_row.id
    AND item.recurrence_group_id = p_recurrence_group_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_expected_count THEN
    RAISE EXCEPTION
      'Series update was blocked: expected % rows, updated %',
      v_expected_count,
      v_updated_count;
  END IF;

  DELETE FROM public.marketing_calendar_item_companies AS item_company
  USING public.marketing_calendar_items AS item
  WHERE item_company.item_id = item.id
    AND item.recurrence_group_id = p_recurrence_group_id;

  INSERT INTO public.marketing_calendar_item_companies (item_id, company_id)
  SELECT item.id, selected_company.company_id
  FROM public.marketing_calendar_items AS item
  CROSS JOIN (
    SELECT DISTINCT company_id
    FROM unnest(p_company_ids) AS company_row(company_id)
  ) AS selected_company
  WHERE item.recurrence_group_id = p_recurrence_group_id;

  GET DIAGNOSTICS v_inserted_company_count = ROW_COUNT;

  IF v_inserted_company_count <> v_expected_count * v_company_count THEN
    RAISE EXCEPTION
      'Company update was incomplete: expected % rows, inserted %',
      v_expected_count * v_company_count,
      v_inserted_company_count;
  END IF;

  RETURN v_updated_count;
END;
$$;

REVOKE ALL
  ON FUNCTION public.update_marketing_calendar_series_atomic(
    UUID,
    JSONB,
    TEXT,
    BOOLEAN,
    UUID[]
  )
  FROM PUBLIC, anon;

GRANT EXECUTE
  ON FUNCTION public.update_marketing_calendar_series_atomic(
    UUID,
    JSONB,
    TEXT,
    BOOLEAN,
    UUID[]
  )
  TO authenticated;

COMMIT;
