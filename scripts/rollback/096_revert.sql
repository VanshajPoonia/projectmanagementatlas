-- Rollback for 096_restore_signup_profile_trigger.sql.
--
-- Removes the on_auth_user_created trigger again.
--
-- ⚠️ Running this means new signups stop getting a public.profiles row. Since profiles.role
-- drives every permission check in the app, an account created afterwards would be unusable.
-- There is essentially no good reason to run this except to reproduce the broken state while
-- diagnosing something.
--
-- Not a numbered migration; the runner will not pick it up. Apply it deliberately, then:
--     DELETE FROM public.applied_migrations WHERE filename = '096_restore_signup_profile_trigger.sql';

BEGIN;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

COMMIT;
