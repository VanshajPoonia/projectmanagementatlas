-- Revert 139 (social caption history).
--
-- ⚠️ DESTROYS DATA: every earlier wording goes with the table. Each post keeps the caption it
-- has now. Dump public.social_post_caption_versions first if the history should survive.

BEGIN;

DROP FUNCTION IF EXISTS public.edit_social_post_caption(UUID, TEXT, TEXT[], TEXT, TEXT[], UUID);
DROP FUNCTION IF EXISTS private.save_social_caption(UUID, TEXT, TEXT[], TEXT, TEXT[], UUID, UUID);
DROP TABLE IF EXISTS public.social_post_caption_versions;

COMMIT;
