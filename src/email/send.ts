// The transport seam.
//
// The package renders every message and never sends one. Each site keeps its
// own sender — a transactional-email wrapper, a virtual module with a dev
// outbox — and hands it in. That is what lets
// the same templates run on a Netlify build and in a Cloudflare Worker, and it
// keeps the dev outbox working: a preview that bypassed the site's sender would
// quietly deliver mail that `astro dev` is supposed to capture.

export interface OutgoingEmail {
  /** `Name <address@domain>`. */
  from: string
  to: string[]
  cc?: string[]
  subject: string
  html: string
  /** The sending account, when the site's transport takes one per message. */
  apiKey?: string
  replyTo?: string
}

export type MailSender = (message: OutgoingEmail) => Promise<unknown>

/**
 * A sender that records instead of sending, for previews and dry runs.
 * Returns the messages it was given, in order.
 */
export function collectingSender(): MailSender & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = []
  const send = (async (message: OutgoingEmail) => {
    sent.push(message)
    return undefined
  }) as MailSender & { sent: OutgoingEmail[] }
  send.sent = sent
  return send
}
