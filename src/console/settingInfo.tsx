import * as React from 'react'

/**
 * The long version of every setting, behind the "i" beside it.
 *
 * The one-line hint on the row says what the control does; this says what
 * happens when it is wrong, what it costs to leave on, and where the value
 * actually lives — the things you want before changing something the whole site
 * reads.
 */

export interface SettingInfo {
  title: string
  sub: string
  body: React.ReactNode
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {title}
    </h4>
    <div className="space-y-2 text-sm leading-relaxed">{children}</div>
  </div>
)

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
)

const Cost = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-lg border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
    {children}
  </p>
)

export const SETTING_INFO: Record<string, SettingInfo> = {
  canaryEnabled: {
    title: 'Run the daily check',
    sub: 'A form submission we make ourselves, every day.',
    body: (
      <div className="space-y-4">
        <Section title="What it does">
          <p>
            Once a day a schedule calls this site's <Code>/api/canary</Code>, which walks a quote
            through every profile the way a real visitor would. It checks:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>Routing</b> — the profile's own routing value still resolves to it.
            </li>
            <li>
              <b>Catalog</b> — the pricing back end returns its options. An empty list here is an empty
              dropdown on the live form.
            </li>
            <li>
              <b>Pricing</b> — a preview comes back with a total. Without it the thank-you page and
              the email both go blank where the numbers should be.
            </li>
            <li>
              <b>Webhook payload</b> — the lead shapes into the declared keys with nothing
              unexpectedly empty.
            </li>
            <li>
              <b>Envelope</b> — the From address is one a mail server will take and the To list is
              not empty.
            </li>
            <li>
              <b>Render</b> — both emails build, and the profile's brand is really in them.
            </li>
          </ul>
          <p>
            Then it emails one digest and answers <Code>200</Code> only when everything passed — so
            the schedule's own log shows a failure as a failure.
          </p>
        </Section>
        <Section title="What turning it off means">
          <p>
            Nothing runs and no digest arrives. A form that broke on Monday stays broken until a
            customer tells you, or until you happen to test it yourself.
          </p>
        </Section>
        <Section title="Where it lives">
          <p>
            <Code>SITE_SETTINGS.canaryEnabled</Code> in the site's config. The scheduled call also
            needs <Code>CANARY_TOKEN</Code> in the environment, otherwise the endpoint refuses
            rather than running unguarded.
          </p>
        </Section>
        <Cost>
          Costs one quote preview per profile per day. <b>No lead is ever posted to the
          CRM</b> — a junk lead a day buys little, because the CRM answers 200 to a payload it
          cannot even map.
        </Cost>
      </div>
    ),
  },

  canarySendEmails: {
    title: 'Really deliver the probe emails',
    sub: 'The difference between checking the email builds and checking it arrives.',
    body: (
      <div className="space-y-4">
        <Section title="What it does">
          <p>
            After rendering, the client email is <b>really sent</b> through the site's transport — using the
            configured From address and sending account, with only the recipient swapped for the
            monitoring inbox. The subject is prefixed <Code>[canary]</Code> so it is obvious in the
            inbox.
          </p>
        </Section>
        <Section title="Why it is not just belt and braces">
          <p>
            This check was written after an outage where leads produced no email at all. Everything
            upstream was fine: the submission routed, the quote priced, the HTML built. The transport rejected
            the message at send time because the From domain was not verified in the workspace whose
            key was sending it. <b>Only a real send sees that</b> — a dry run would have reported
            everything green through the whole outage.
          </p>
        </Section>
        <Section title="What turning it off means">
          <p>
            Everything up to delivery is still checked and the digest still arrives, but the
            From/sending-account pairing goes untested. That is the pairing that failed.
          </p>
        </Section>
        <Cost>Costs one extra email per profile per day, all to the one address below.</Cost>
      </div>
    ),
  },

  canaryEmailTo: {
    title: 'Send the digest and probes to',
    sub: 'The inbox that finds out first.',
    body: (
      <div className="space-y-4">
        <Section title="What lands here">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>One digest a day</b> — every check, pass or fail, with the detail.
            </li>
            <li>
              <b>One <Code>[canary]</Code> quote email per profile</b>, when delivery is switched on
              above.
            </li>
          </ul>
          <p>
            One address only. It is also used as the lead's email address inside the probe, so
            nothing the check creates ever points at a real person.
          </p>
        </Section>
        <Section title="Pick a monitored inbox, not a person">
          <p>
            Silence is the failure mode here. If the digest stops arriving, the <i>check</i>{' '}
            stopped — and that is only noticed if somebody would miss it. A shared inbox survives
            someone being on leave in a way a personal one does not.
          </p>
        </Section>
        <Section title="Overriding it without a deploy">
          <p>
            <Code>CANARY_EMAIL_TO</Code> in the environment wins over this value, which is how a
            deploy preview can be pointed somewhere else without editing the config.
          </p>
        </Section>
      </div>
    ),
  },

  marketingCc: {
    title: 'Copy every email to',
    sub: 'One address added to every message the site sends.',
    body: (
      <div className="space-y-4">
        <Section title="What it does">
          <p>
            The transport adds this address to <b>every</b> message: the customer's confirmation,
            the team's copy, and any other mail this site sends. It is why a delivered message
            carries one more Cc than the envelope in the Editor shows.
          </p>
        </Section>
        <Section title="It is a Cc, not a Bcc">
          <p>
            The customer who receives their quote confirmation can see this address in the message
            headers. Use one you are happy to show them, and one that can take replies — a customer
            hitting "reply all" will include it.
          </p>
        </Section>
        <Section title="What emptying it means">
          <p>Mail still sends; nobody is copied. Nothing else about the message changes.</p>
        </Section>
      </div>
    ),
  },

}
