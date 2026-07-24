-- View-only share links (V's PM Portal #: "View Only Link Access, Board vs Task"):
-- "a button ... on the board or the task level ... create a view only link that goes to whomever
-- we want it to go to."
--
-- An authenticated user mints an unguessable, revocable token that grants UNAUTHENTICATED,
-- read-only access to exactly one board or task. The public /share/[token] route validates the
-- token server-side and fetches only that single resource via the service role (which bypasses
-- RLS) — so this table itself never needs an anon SELECT policy, and the token is the only
-- capability. Revoking (revoked_at) or expiring (expires_at) a row kills the link immediately.

BEGIN;

CREATE TABLE IF NOT EXISTS public.share_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text NOT NULL UNIQUE,
  resource_type text NOT NULL CHECK (resource_type IN ('board', 'task')),
  resource_id   uuid NOT NULL,
  created_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_share_links_token ON public.share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_resource ON public.share_links(resource_type, resource_id);

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

-- Authenticated users manage their OWN links; admins can see/revoke any (managerial oversight,
-- mirrors the is_admin_user() chokepoint used elsewhere). No anon access at all — the public
-- viewer never queries this table directly; the server does, via the service role, only after
-- validating the token. Creation is additionally gated in the UI to a board/task's
-- creator/admins, so a low-privilege member can't quietly expose something externally.
DROP POLICY IF EXISTS "Manage own share links" ON public.share_links;
CREATE POLICY "Manage own share links" ON public.share_links FOR ALL
  TO authenticated
  USING (created_by = auth.uid() OR private.is_admin_user())
  WITH CHECK (created_by = auth.uid());

COMMIT;
