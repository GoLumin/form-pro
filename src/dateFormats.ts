/**
 * How a date is written, shared by the emails and the CRM payloads.
 *
 * Both start from the same mm/dd/yyyy string the form resolved, and both read
 * the numbers straight out of it rather than going back through `Date`: a plain
 * date has no timezone, so re-parsing lands on UTC midnight and shows the day
 * before anywhere west of it.
 *
 * They are separate settings on purpose. An email's date is presentation; a
 * webhook's is a contract with that CRM's field mapping, and changing it can
 * make the CRM reject the lead.
 */

export const DATE_FORMATS = [
  'mm/dd/yyyy',
  'm/d/yyyy',
  'Month D, YYYY',
  'Mon D, YYYY',
  'Weekday, Month D',
  'D Month YYYY',
  'yyyy-mm-dd',
] as const

export type DateFormat = (typeof DATE_FORMATS)[number]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

/** Anything that is not mm/dd/yyyy passes straight through, unchanged. */
export function formatDateAs(value: string, format: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value ?? '').trim())
  if (!m) return value
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const name = MONTHS[month - 1]
  if (!name) return value
  const pad = (n: number) => String(n).padStart(2, '0')

  switch (format) {
    case 'm/d/yyyy':
      return `${month}/${day}/${year}`
    case 'Month D, YYYY':
      return `${name} ${day}, ${year}`
    case 'Mon D, YYYY':
      return `${name.slice(0, 3)} ${day}, ${year}`
    case 'Weekday, Month D':
      return `${DAYS[new Date(year, month - 1, day).getDay()]}, ${name} ${day}`
    case 'D Month YYYY':
      return `${day} ${name} ${year}`
    case 'yyyy-mm-dd':
      return `${year}-${pad(month)}-${pad(day)}`
    default:
      return `${pad(month)}/${pad(day)}/${year}`
  }
}
