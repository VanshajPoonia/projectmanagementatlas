-- Revert 110: put board archiving back in the hands of any admin.
--
-- Restores 069 Part B's function verbatim: restore stays super-admin-only, archiving goes back
-- to being allowed for any admin the boards UPDATE policy already accepts.
--
-- Destroys no data. Both 110 and this revert govern a column transition, never a row, so no
-- board changes and no archive stamp is added or cleared by running either one.

BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_board_restore_super_admin()
 RETURNS TRIGGER
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL AND NOT private.is_super_admin_user() THEN
    RAISE EXCEPTION 'Only a super admin can restore an archived board'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = 'enforce_board_restore_super_admin')
     LIKE '%Only a super admin can archive a board%' THEN
    RAISE EXCEPTION '110 revert post-condition: the archive branch is still present';
  END IF;
END $$;

COMMIT;
