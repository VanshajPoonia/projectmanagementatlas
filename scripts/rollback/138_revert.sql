-- Revert 138 (social post approvals).
--
-- ⚠️ DESTROYS DATA: every post, review and decision goes with the tables. Uploaded files stay
-- in the social-media bucket until removed from Storage; delete them there first if wanted.

BEGIN;

DROP POLICY IF EXISTS "Marketing team reads social media files" ON storage.objects;
DROP POLICY IF EXISTS "Marketing team uploads social media files" ON storage.objects;
DROP POLICY IF EXISTS "Marketing team replaces social media files" ON storage.objects;
DROP POLICY IF EXISTS "Marketing team removes social media files" ON storage.objects;

DROP TABLE IF EXISTS public.social_post_reviews;
DROP TABLE IF EXISTS public.social_posts;
DROP FUNCTION IF EXISTS private.social_post_follow_review();

DELETE FROM public.app_modules WHERE module_key = 'social_media';

COMMIT;
