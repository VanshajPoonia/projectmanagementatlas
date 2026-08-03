/**
 * Booking confirmation email — deliberately NOT in lib/email.ts.
 *
 * Every exported function in lib/email.ts is a Server Action (that file starts
 * with 'use server'), which Next.js makes directly callable from the client
 * regardless of what imports it. lib/email.ts's own functions guard against
 * that by requiring requireSession() on every call. A booking confirmation is
 * sent to an UNAUTHENTICATED visitor, so it cannot use that gate — and adding
 * an ungated exception to lib/email.ts would create a new public, unguarded
 * "send an email" endpoint.
 *
 * This module is a plain (non-Server-Action) file, imported only by
 * app/api/book/[token]/route.ts — a Route Handler, not a Server Action, so it
 * is never independently invocable the way an exported 'use server' function
 * would be. The route itself never trusts a client-supplied email address:
 * it always re-reads guest_email from the appointment row it just inserted,
 * and the caller guards the whole send with a one-time
 * `confirmation_sent_at IS NULL` update, so there is no way to trigger a
 * second send for the same appointment.
 */

import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM || 'Project Manager <onboarding@resend.dev>'

// Constructed lazily, only once RESEND_API_KEY is confirmed present (see
// send() below) — Resend's constructor throws immediately when the key is
// missing/empty, and unlike lib/email.ts (a 'use server' file, whose
// top-level code Next.js does not eagerly evaluate the same way), this
// module is imported by a plain Route Handler, which Next DOES fully load
// during the build to inspect its exports. A module-scope `new Resend(...)`
// here broke `next build` in any environment without the key configured.
let resendClient: Resend | null = null
function getResendClient(): Resend {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY)
  return resendClient
}

function renderEmail(heading: string, rows: { label: string; value: string }[], action: string) {
  const rowsHtml = rows
    .map(
      ({ label, value }) => `
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#475569;white-space:nowrap;vertical-align:top">${label}</td>
          <td style="padding:8px 12px;color:#0f172a">${value}</td>
        </tr>`
    )
    .join('')

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#2563eb;color:#fff;padding:16px 20px;font-size:16px;font-weight:600">${heading}</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rowsHtml}</table>
      <div style="padding:16px 20px;border-top:1px solid #e2e8f0;color:#2563eb;font-size:14px">${action}</div>
    </div>
  </div>`
}

async function send(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[appointment-email] RESEND_API_KEY is not set; skipping email to', to)
    return
  }
  try {
    const { error } = await getResendClient().emails.send({ from: FROM, to, subject, html })
    if (error) console.error('[appointment-email] Failed to send to', to, error)
  } catch (error) {
    console.error('[appointment-email] Error sending to', to, error)
  }
}

function formatWhen(startsAt: string, endsAt: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
  return `${fmt.format(new Date(startsAt))} – ${new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(endsAt))}`
}

export async function sendBookingConfirmationEmails(params: {
  guestEmail: string
  guestName: string
  hostEmail: string | null
  hostName: string
  startsAt: string
  endsAt: string
  timeZone: string
  cancelUrl: string
}) {
  const { guestEmail, guestName, hostEmail, hostName, startsAt, endsAt, timeZone, cancelUrl } = params
  const when = formatWhen(startsAt, endsAt, timeZone)

  await send(
    guestEmail,
    `Appointment confirmed: ${when}`,
    renderEmail(
      '✅ Appointment Confirmed',
      [
        { label: 'With', value: hostName },
        { label: 'When', value: when },
      ],
      `Need to cancel? <a href="${cancelUrl}">Cancel this appointment</a>`,
    ),
  )

  if (hostEmail) {
    await send(
      hostEmail,
      `New appointment booked: ${when}`,
      renderEmail(
        '📅 New Appointment Booked',
        [
          { label: 'Guest', value: guestName },
          { label: 'Guest Email', value: guestEmail },
          { label: 'When', value: when },
        ],
        'This was booked through your public booking link.',
      ),
    )
  }
}
