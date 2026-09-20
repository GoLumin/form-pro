// Better Auth, wired to whatever database the site handed in.
//
// Email OTP rather than a password: the people who use this console already
// have a work inbox, and a shared password in a repository — which is what this
// replaces — is a credential nobody can rotate or revoke for one person.
//
// Sign-up is disabled. By default `signIn.emailOtp()` registers anyone who can
// receive a code, which on a console that commits to production is the wrong
// default. Who may sign in is declared in the site's SITE_SETTINGS, so adding
// someone is a config change that goes through the same review and deploy as
// everything else the console edits.

import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { SITE_SETTINGS } from 'virtual:form-pro/config'
import { sendEmail } from 'virtual:form-pro/mail'
import options from 'virtual:form-pro/options'
import { envValue } from '../env.ts'
import { handle } from '../db/index.ts'
import { otpEmail } from '../email/otpEmail.ts'

/** Who may sign in. Empty means nobody, which is safer than everybody. */
export function allowlist(): string[] {
  const list = (SITE_SETTINGS as { consoleUsers?: string[] }).consoleUsers ?? []
  return list.map((a) => a.trim().toLowerCase()).filter(Boolean)
}

export function isAllowed(email: string): boolean {
  return allowlist().includes(email.trim().toLowerCase())
}

let instance: ReturnType<typeof betterAuth> | null = null

/**
 * Null when the site has no database, which is the signal to fall back to the
 * shared-password gate rather than to refuse everyone.
 */
export function auth() {
  if (instance) return instance
  const database = handle()
  if (!database) return null

  const secret = envValue('BETTER_AUTH_SECRET')
  if (!secret) {
    console.error(
      'form-pro: BETTER_AUTH_SECRET is not set, so sign-in is unavailable and the console stays on its shared password.'
    )
    return null
  }

  instance = betterAuth({
    secret,
    baseURL: envValue('BETTER_AUTH_URL') || undefined,
    basePath: `${options.route}/auth`,
    database: { dialect: database.dialect as any, type: database.type },
    // Nothing here issues passwords; the OTP is the whole credential.
    emailAndPassword: { enabled: false },
    session: {
      // Long enough that nobody is signing in twice a day, short enough that a
      // forgotten laptop is not a standing key to production.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      emailOTP({
        disableSignUp: true,
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 3,
        async sendVerificationOTP({ email, otp, type }) {
          // Checked here as well as at the endpoint: this is the last point
          // before a code reaches an inbox, and a code nobody asked for is
          // worse than a refusal.
          if (!isAllowed(email)) {
            throw new Error(`${email} is not on this site's console allowlist.`)
          }
          const rendered = otpEmail({ otp, type, brand: options.title, minutes: 10 })
          await sendEmail({
            from: rendered.from,
            to: [email],
            subject: rendered.subject,
            html: rendered.html,
          })
        },
      }),
    ],
  })
  return instance
}

/** The signed-in user for a request, or null. */
export async function sessionUser(
  request: Request
): Promise<{ email: string; name?: string | null } | null> {
  const a = auth()
  if (!a) return null
  try {
    const result = await a.api.getSession({ headers: request.headers })
    const email = result?.user?.email
    if (!email) return null
    // The allowlist is re-checked per request rather than only at sign-in, so
    // removing someone takes effect on their next click instead of whenever
    // their session happens to expire.
    if (!isAllowed(email)) return null
    return { email, name: result.user.name }
  } catch (error) {
    console.error('form-pro: could not read the session:', error)
    return null
  }
}
