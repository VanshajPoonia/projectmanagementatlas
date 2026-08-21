# In Progress - V's TaskApp MACD

Snapshot taken **2026-08-21** read-only from **production** (`icyfluwgyuimhwlddjyy`), scoped to the
board **V's TaskApp MACD** (`49157eb8-7c29-43e4-a042-faf55bb89938`) - Bobby's running backlog of
bugs and feature requests *for this PM app itself*. This is the board behind the `Vs PM Portal` tab
in `Marketing Project Management.xlsx`.

**3 tasks are In Progress.** The board holds 58 tasks total: 39 Completed, 15 To Do, 3 In Progress,
1 Cancelled.

## Where this came from, and why not the spreadsheet

The `Vs PM Portal` tab in the xlsx has a `TESTED` and an `Approved` column and **both are entirely
empty** for all 28 rows, with no cell-fill colour coding either. It cannot say what is in progress.
It is also a stale export (file mtime 2026-06-27; newest row dated 2026-06-25) while the board has
moved on considerably since. The board is the source of truth; the sheet is where Bobby *files* new
requests.

Status was resolved through `column_id -> columns.status_key`, which is the FK source of truth per
migration `063`, not through the raw `tasks.status` string. On this board the two agree exactly
(39/15/3/1 both ways), so there is no ambiguity to resolve here.

To regenerate: read prod read-only through `.env.production.local` (REST, or the pooler URL that
file carries - `db.<ref>.supabase.co` is IPv6-only and unreachable from this Mac). **Do not run
`vercel env pull` in this folder** - it overwrites `.env.local`'s dev-sandbox credentials with
production ones and defeats the DB guardrail.

---

## 1. Need to be able to edit the channel names and turn them on/off

| | |
|---|---|
| id | `fa2ba29c-e3d9-4fe8-9d8f-9af5a34e8cbe` |
| priority | 2 |
| due | **2026-08-31** |
| assignees | Kayla Viehland, Vanshaj |
| created | 2026-08-18 by Bobby Shanks |

No description. Moved from the "Marketing PM Sheet" board into In Progress here on 2026-08-18.

**Assessment: built and reachable. Needs Bobby/Kayla to confirm, not more code.**

Verified in the code, both halves:

- **Edit names** - two paths, deliberately sharing one RPC. The `Edit channels` dialog
  ([channel-manager.tsx](components/marketing/channel-manager.tsx)), and inline on the grid's own
  column header ([marketing-calendar.tsx:2658](components/marketing/marketing-calendar.tsx#L2658)),
  shipped 2026-08-21 in `bd39708`. Both call `rename_marketing_channel`, which renames the channel
  and re-points its events in one transaction - `marketing_calendar_items.channel` is TEXT with no
  FK, so a rename that skips the second write orphans every post filed under the old name.
- **Turn on/off** - per-channel `Turn on` / `Turn off` in the same dialog
  ([channel-manager.tsx:148](components/marketing/channel-manager.tsx#L148)), calling
  `set_marketing_channel_archived`. Archiving, never DELETE, for the same orphaning reason; the
  toast reports how many scheduled posts were kept.

Reachable by any marketing calendar member, not just admins
([marketing-calendar.tsx:2352](components/marketing/marketing-calendar.tsx#L2352)) - migration `105`
set that boundary as `private.can_manage_marketing_channels()`, deliberately the same set of people
who can see the tab at all.

Migration `105` is on production (prod ledger is at `108`), and the UI shipped 2026-08-21, so this
is live now.

Gates: `pnpm check:marketing-channels` (39), `pnpm check:marketing-channel-ui` (8).

---

## 2. Main Navigation in each Tile/Board

| | |
|---|---|
| id | `f052661f-1d60-4fd1-aed8-f80925a210bb` |
| priority | 3 |
| due | 2026-07-15 (**overdue**) |
| assignees | Vanshaj |
| created | 2026-06-29 by Bobby Shanks |

> When you're in a tile and working on it you lose the main text navigation menu unless you save it
> and hit home. It would be convenient to have the navi menu at the top pretty much all the time
> which should also make it mobile friendly.

**Assessment: built. Needs Bobby to confirm, not more code.**

A board renders outside `AppShell`, which is why it had no nav. Fixed 2026-08-21 in `c8140f8`:

- The board header is `sticky top-0 z-50`
  ([board-view.tsx:1147](components/board/board-view.tsx#L1147)) - "at the top pretty much all the
  time", literally.
- Its nav now comes from `buildWorkspaceNav`, the same builder as the sidebar and the Command-K
  palette, rather than the two hand-written arrays it used to keep. Those arrays predated the
  `appointments` and `crm` modules and had drifted: no My Work at all, Marketing offered to every
  admin whether or not the module was on, and navigation that pushed a bare `/admin` or `/dashboard`
  picked from a surface flag rather than the viewer's role.
- Rendered as one `DropdownMenu` rather than a strip of icons. At four entries a strip was fine; at
  twelve it ate the header and squeezed the board title off its own page. A menu costs one button's
  width whatever the workspace has switched on, and it can carry labels.
- Mobile: a bottom bar with five promoted destinations and the rest behind "More"
  ([board-view.tsx:241](components/board/board-view.tsx#L241)).

Gate: `pnpm check:board-nav` (17), which asserts the page does not scroll sideways and the board
title still measures over 100px.

---

## 3. Chat improvements - message truncation

| | |
|---|---|
| id | `ccb3d8e6-0669-40ca-91b3-3d58ff04849f` |
| priority | 3 |
| due | - |
| assignees | Vanshaj |
| created | 2026-06-27 by Vanshaj |

> see the attached screen shot.
>
> what i posted there is several paragraphs in latin for just dummy text. Notice how when you submit
> the text it truncates when it's posted. but while youre writing it out it doesn't. Need to be able
> to see all the message while it's being typed.
>
> - Requested by Bobby (V's PM Portal #18, added 2026-01-22)

**Assessment: genuinely open. This is the one with real work in it.**

### What is NOT the cause

Both ruled out by inspection rather than assumed:

- `chat_messages.message` is `TEXT` (`003_initial_schema_v2.sql:60`). No length limit, nothing
  truncated on write. `handleSendMessage` sends `newMessage.trim()` with no slice and no `maxLength`
  on the field.
- The message bubble renders `whitespace-pre-wrap break-words`
  ([chat-message.tsx:53](components/chat/chat-message.tsx#L53)), which wraps and preserves newlines.
  It never truncated: `git log -S"whitespace-pre-wrap"` puts that class in the initial commit.

### What IS the cause

The composer is a single-line `<Input>`
([chat-panel.tsx:300](components/chat/chat-panel.tsx#L300)) inside a `<form>`. That one choice
produces **both** halves of Bobby's report:

1. **"Need to be able to see all the message while it's being typed."** A single-line input scrolls
   horizontally, so only the tail of a long message is ever visible.
2. **"When you submit the text it truncates when it's posted."** The HTML spec's value sanitization
   algorithm for `<input type="text">` **strips every CR and LF from the value**. Bobby pasted
   several paragraphs; the paragraph breaks were discarded at paste time, before anything was sent.
   What landed in the database was one run-on block, which is exactly what a truncated multi-paragraph
   message looks like. The bubble was rendering faithfully what it had been given.

   Enter also submits the form, so there was no way to type a newline either.

The sanitizer claim was confirmed in a real browser rather than left resting on the spec: assigning
`"Para one.\n\nPara two."` to an `<input type="text">` reads back as `"Para one.Para two."`, while a
`<textarea>` returns it intact.

### Fix - DONE 2026-08-21

The composer is now an auto-growing `<Textarea>`
([chat-panel.tsx](components/chat/chat-panel.tsx)). Newlines survive, and the bubble's existing
`whitespace-pre-wrap` renders them as the paragraphs Bobby wrote.

- **Enter sends on a keyboard, Shift+Enter makes a newline.** On a **touchscreen** Enter always makes
  a newline and Send is the only way to send. Keyed on `(pointer: coarse)`, matching the rule
  `app/globals.css` already uses for touch targets. Binding send to Enter on a phone would leave a
  thumb no way to type a paragraph break, which is this exact bug reintroduced on the device the
  board also has an open mobile task for.
- **An IME mid-composition never sends** - that Enter is committing a candidate.
- **The box grows with the content**, capped at 160px (about seven lines), then scrolls rather than
  pushing the message list off screen.
- The `Textarea` primitive carries `field-sizing-content`, which does this natively **only in
  Chromium**. Safari ignores it, and Safari is the iPhone, so the height is measured in JS.

One defect the browser pass caught that code review had not: `scrollHeight` covers content and
padding but **not** the border, while `box-sizing: border-box` makes `height` include it. Assigning
`scrollHeight` straight across left the box 2px short and clipped its own last line.

Decision logic is in [lib/chat-composer.ts](lib/chat-composer.ts) with 8 unit tests, because the
touch rule is invisible to a keyboard-only reviewer and regresses silently.

Gate: `pnpm check:chat-composer` (15 checks), which sends a real multi-paragraph message through a
real browser and asserts the newlines reach the database, plus an emulated iPhone pass asserting
Enter does not send there.

### Still open for Bobby

The build note records that the original request text was cut off in his sheet, so there may be more
to this item than the truncation. Worth confirming now the composer fix is in front of him.
