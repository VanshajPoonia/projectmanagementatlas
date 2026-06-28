-- 043_attachment_size_db_check.sql
-- Security audit finding: task_attachments.file_size is metadata the client
-- reports itself (components/board/task-detail-modal.tsx sends file_size and
-- file_data as separate fields) — nothing tied it to the actual size of
-- file_data. The 10MB cap in the UI is JS-only, so an authenticated user could
-- send a small file_size alongside an arbitrarily large file_data payload.
--
-- Fix: a CHECK constraint on the real payload (octet_length of the base64
-- text, ~14MB ceiling = 10MB raw * 4/3 base64 inflation + headroom for the
-- "data:mime/type;base64," prefix), enforced at the DB layer regardless of
-- what the client claims.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/043_attachment_size_db_check.sql

BEGIN;

ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_file_data_size_check
  CHECK (octet_length(file_data) <= 14000000);

COMMIT;
