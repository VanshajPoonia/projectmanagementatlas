# Appointment restrictions & external booking - implementation plan

**Source:** a screen recording of a ShowingTime-style real-estate showing scheduler
(`~/Downloads/20260730-1918-50.5170737.mp4`, 41s), confirmed by the owner as "the feature we want."
Bobby's ask, as relayed: *"be able to restrict things, and select appointment lengths, days, even
recurring limit, like from when to when it will be recurring."*

**Scope decision (owner, 2026-08-03):** host-level rules **+ external/client booking**. Restrictions
hang off a **person** (`profiles`), not a property - this app has no listing/property entity and
inventing one is a much larger domain. Consequence: one global ruleset per host. Per-property or
per-project scoping is deliberately **not** built (same precedent as `teams` in CLAUDE.md - add a
scope column when a real need appears, not speculatively).

---

## 1. Existing-system audit

Reusable, already in the repo:

| Asset | Where | How it applies |
|---|---|---|
| Token-scoped public access | `scripts/072_share_links.sql`, `app/share/[token]/page.tsx` | Exact pattern for the public booking page: service-role read after server-side token validation, so the table needs no `anon` RLS policy. |
| Pure, testable link validators | `lib/public-share.ts` | `isValidShareToken` (64-hex), `isPublicShareLinkActive` (revoked/expired). Mirror these rather than reinvent. |
| Atomic multi-row write via RPC | `scripts/078_atomic_marketing_series_updates.sql` | Precedent for doing validation + write in one transaction. Booking needs exactly this to avoid double-booking. |
| Module toggles | `scripts/066_app_modules.sql`, `lib/modules.ts` | New module registers here so a super-admin can turn it off. |
| Transactional email | `lib/email.ts` (Resend) | Templates reusable - **but see the constraint in §6.** |

Not present, must be built: any notion of appointment, availability, booking, or calendar
time-slot. `tasks.due_date` is a date, not a bookable interval.

---

## 2. Conflicts & clashes found (resolve before coding)

**a. `share_links.resource_type` collides with pending migration 074.**
The obvious shortcut - add `'appointment_host'` to `share_links.resource_type` - will break. Pending
`074_harden_task_lifecycle_activity_and_sharing.sql` replaces the share-links policies with a
`Create authorized share links` INSERT policy that only permits `resource_type` of `'board'` or
`'task'`; anything else is rejected by `WITH CHECK`. Since 074 is still unapplied on prod and awaiting
sign-off, entangling the two is avoidable risk.
→ **Use a separate `appointment_booking_links` table.** No shared surface, no ordering dependency.

**b. `lib/email.ts` cannot send the booking confirmation.**
Every sender calls `requireSession()`, deliberately - the file's own comment: *"These functions are
Server Actions invokable directly from the client, so they're a public RPC endpoint. Require a
logged-in session to stop anyone from using them to spam arbitrary addresses."* A public booking
confirmation is sent by an **unauthenticated** visitor.
→ Needs a separate server route that sends without a session, which reopens the exact spam-relay
risk that gate was protecting against. See §6 - this is the main security design work.

**c. Overlaps with Phase 7 (Client/stakeholder portal), currently NOT STARTED.**
A public, token-scoped page for outside parties is squarely portal territory, and CLAUDE.md Phase 4
says the portal builds on `board_members.role` (`member`/`guest`/`client`, shipped in `065`).
Building booking as a wholly separate public-access system risks two parallel mechanisms.
→ **Decision needed:** standalone module now (faster, some duplication), or the first slice of the
Phase 7 portal (slower, coherent). Recommend standalone - booking is anonymous and capability-based,
whereas the portal is identity-based via `board_members`; they are genuinely different auth models.

---

## 3. User flows

**Host (Bobby), authenticated.**
1. Opens Appointments settings.
2. Sets booking preferences: min/max appointment length, required + suggested lead time, same-day
   allowed, overlaps allowed and max concurrent, timezone.
3. Adds restriction windows. Each is either:
   - **one-time** - a date range, all-day or a time range; or
   - **repeating** - a date range *plus* a day-of-week set (the video's Sun–Sat checkboxes).
4. Sees them in a table matching the video: Start Date · End Date · Days & Time · Reason.
5. Mints a booking link (revocable, optionally expiring), copies the URL.

**Visitor, unauthenticated.**
1. Opens `/book/[token]`. Invalid/revoked/expired → the same dead-end card as `/share/[token]`.
2. Sees available slots, computed from preferences minus restrictions minus existing appointments.
3. Picks a slot, enters name + email (+ optional phone/note), submits.
4. Server re-validates everything atomically and writes the appointment.
5. Both parties get an email. Visitor's includes a cancel link.

---

## 4. Data model

Four tables. Restrictions are **evaluated rules, never materialized rows** - deliberately unlike the
marketing calendar's recurrence, which expands to one `marketing_calendar_items` row per date.
Forcing those two into one shape is the modelling mistake to avoid.

```sql
-- One row per host.
appointment_settings (
  user_id                  uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  min_duration_minutes     int  NOT NULL DEFAULT 30,
  max_duration_minutes     int,            -- NULL = the video's "None"
  required_lead_time_hours int  NOT NULL DEFAULT 0,
  suggested_lead_time_hours int,
  allow_same_day           boolean NOT NULL DEFAULT true,
  allow_overlaps           boolean NOT NULL DEFAULT false,
  max_overlaps             int,            -- NULL = "No overlap limit"
  timezone                 text NOT NULL DEFAULT 'America/Chicago',
  updated_at               timestamptz NOT NULL DEFAULT now()
)

-- Many per host. weekdays = [] means one-time; populated means repeating.
appointment_restrictions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason         text NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  is_all_day     boolean NOT NULL DEFAULT false,
  starts_at_time time,
  ends_at_time   time,
  weekdays       smallint[] NOT NULL DEFAULT '{}',   -- 0=Sun … 6=Sat
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (is_all_day OR (starts_at_time IS NOT NULL AND ends_at_time IS NOT NULL)),
  CHECK (is_all_day OR ends_at_time > starts_at_time)
)

-- Public capability link. Separate from share_links - see §2a.
appointment_booking_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token      text NOT NULL UNIQUE,
  host_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
)

appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  booking_link_id uuid REFERENCES appointment_booking_links(id) ON DELETE SET NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  guest_name      text NOT NULL,
  guest_email     text NOT NULL,
  guest_phone     text,
  note            text,
  status          text NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed','cancelled')),
  cancel_token    text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
)
```

`weekdays` unifies both row types visible in the video's table: the `08/02–08/02` "One-time
restriction" row is `weekdays = '{}'`, and the `07/29–08/01` "W Th F Sa" row is `weekdays =
'{3,4,5,6}'`.

**Timezone is load-bearing.** Restrictions are wall-clock (`time`, `date`); appointments are
absolute (`timestamptz`). The host's `timezone` is what converts between them. Getting this wrong
puts bookings an hour off across a DST boundary.

---

## 5. Booking must be one transaction

Two visitors hitting the same slot concurrently will both pass a read-then-write check. Mirror
`078`'s approach: a `SECURITY DEFINER` function that validates and inserts atomically -

`public.book_appointment(p_token, p_starts_at, p_ends_at, p_guest_name, p_guest_email, …)`

re-checking, inside the transaction: link is live; duration within min/max; lead time satisfied;
same-day rule; slot intersects no restriction window; overlap count within `max_overlaps`.

The client-side slot list is a **convenience, never the authority.** Every rule is re-checked
server-side, because the visitor is unauthenticated and the request is fully forgeable.

---

## 6. Permissions, RLS, and the abuse surface

- All four tables: RLS on, `authenticated` may read/write only rows where `user_id`/`host_user_id`
  is themselves, plus `private.is_admin_user()` for oversight - mirrors `share_links`.
- **No `anon` policy on any table.** The public route reads via service role after validating the
  token, exactly as `/share/[token]` does.
- Token format: 64 hex chars from two UUIDv4s, validated by a `lib/public-booking.ts` helper
  mirroring `isValidShareToken`, so a malformed route param never reaches a service-role query.

Open abuse vectors this introduces - the real work of this feature:

1. **Unauthenticated email sending** (§2b). Mitigation: send only to the address on the booking that
   was just written, never an arbitrary input; hard per-link and per-IP rate limits.
2. **Booking spam.** A live link accepts anonymous writes. Mitigation: rate limit per token/IP, cap
   bookings per link per day, keep links revocable and expiring.
3. **No rate-limit infrastructure exists in this repo today.** Needs building - likely a small
   DB-backed counter table, since the app is on Vercel serverless with no shared memory.

---

## 7. Test plan

- **Pure units** (`lib/appointment-availability.ts`) - the highest-value target, no DB needed:
  restriction↔slot intersection; weekday expansion across a date range; all-day vs timed; DST
  boundary; lead-time cutoff; overlap counting; empty-`weekdays` one-time behaviour.
- **Token validators** - mirror `lib/public-share` tests.
- **RLS harness** - extend the throwaway-user pattern of `scripts/check-board-roles.mjs`: host A
  cannot read host B's settings, restrictions, or appointments; `anon` reads nothing.
- **Concurrency** - two simultaneous `book_appointment` calls for one slot; exactly one succeeds.

---

## 8. Phasing

1. **Host rules** - migration (settings + restrictions), settings UI, restriction table + add/edit
   dialog matching the video, availability engine + unit tests. *Self-contained and useful alone.*
2. **Public booking** - links table, `/book/[token]`, `book_appointment` RPC, rate limiting.
3. **Notifications** - confirmation + cancellation emails, host-side appointment list, cancel flow.

Phase 1 carries no public attack surface and is the foundation for both later phases, so it should
ship and be reviewed before Phase 2 opens an anonymous write path.

---

## 9. Open questions

- §2c: standalone module, or first slice of the Phase 7 portal?
- Whose availability - Bobby only, or any user? (Schema is per-user either way; this is a UI/nav
  question.)
- Should a booking also create a `task`, or stay its own object? (Recommend its own; linking later
  is cheap.)
- Does Bobby need Google Calendar export for bookings? CLAUDE.md permits one-way Google Calendar
  export as one of the two sanctioned integrations.

**There is no written spec beyond the video.** Confirmed by the owner 2026-08-03: Bobby said only
that he wants this functionality - there is no email detailing behaviour. **The recording is the
requirement.** So the questions above are ours to decide, not his to answer; decide them with a
sensible default, note the choice here, and let him react to something working. Do not block on
gathering requirements that do not exist.
