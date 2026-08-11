-- Adds "Personal" as a third business unit alongside SRG and AGC, so a marketing
-- event can be filed as personal rather than being forced onto a company (the
-- create/edit dialogs both require at least one company, by design).
--
-- Data-only and idempotent: companies are otherwise managed from the Super Admin
-- page, and this is exactly the row that page's "Add Company" form would write
-- (it upper-cases the code the same way). It ships as a migration so dev and prod
-- get it without anyone having to remember to click.
--
-- The post-condition asserts the row ends up ACTIVE. If a 'Personal' company were
-- ever archived by hand, this migration rolls back rather than un-archiving behind
-- someone's back — restoring it is a deliberate click in Super Admin, not a silent
-- side effect of running migrations.

BEGIN;

INSERT INTO public.companies (code, name, color, position)
SELECT 'PERSONAL', 'Personal', '#0d9488', COALESCE(MAX(position), -1) + 1
FROM public.companies
ON CONFLICT (lower(code)) DO NOTHING;

DO $post$
DECLARE
  v_active INTEGER;
  v_total  INTEGER;
BEGIN
  SELECT count(*) FILTER (WHERE NOT is_archived), count(*)
  INTO v_active, v_total
  FROM public.companies
  WHERE lower(code) = 'personal';

  IF v_total <> 1 THEN
    RAISE EXCEPTION 'post-condition: expected exactly one Personal company, found %', v_total;
  END IF;

  IF v_active <> 1 THEN
    RAISE EXCEPTION 'post-condition: the Personal company exists but is archived — restore it from Super Admin instead';
  END IF;
END
$post$;

COMMIT;
