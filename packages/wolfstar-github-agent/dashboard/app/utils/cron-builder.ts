import { parseCron } from '../../../src/routine-schedule.ts'
import { describeCron } from './routines.ts'

/**
 * A schedule as a person chooses it. Each plan names one thing a person would
 * say out loud, so the builder never asks anyone to know cron.
 *
 * `custom` carries an expression the other plans cannot say. Nothing is lost:
 * an existing expression stays editable as text, and one a plan can say opens
 * as that plan.
 */
export type CronPlan =
  | { kind: 'minutes'; every: number }
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'custom'; text: string }

export type CronPlanKind = CronPlan['kind']

/** Steps that divide the hour evenly. Any other step restarts at :00 and runs unevenly. */
export const MINUTE_STEPS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30] as const
/** Days 29 to 31 skip the months that lack them, so the builder stops at 28. */
export const LAST_SAFE_DAY_OF_MONTH = 28
export const DEFAULT_CRON_PLAN: CronPlan = { kind: 'daily', time: '09:00' }
export const DEFAULT_CRON = '0 9 * * *'

export const CRON_PLAN_LABELS: Record<CronPlanKind, string> = {
  minutes: 'Every few minutes',
  hourly: 'Every hour',
  daily: 'Every day',
  weekdays: 'Every weekday (Monday to Friday)',
  weekly: 'On chosen days of the week',
  monthly: 'Once a month',
  custom: 'Advanced: type a cron expression',
}

/** Monday first, as a calendar reads. The value is the cron weekday number. */
export const WEEKDAYS = [
  { value: 1, label: 'Mon', name: 'Monday' },
  { value: 2, label: 'Tue', name: 'Tuesday' },
  { value: 3, label: 'Wed', name: 'Wednesday' },
  { value: 4, label: 'Thu', name: 'Thursday' },
  { value: 5, label: 'Fri', name: 'Friday' },
  { value: 6, label: 'Sat', name: 'Saturday' },
  { value: 0, label: 'Sun', name: 'Sunday' },
] as const

const TIME = /^(\d{1,2}):(\d{2})$/

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min
}

/** `HH:MM` as hour and minute, or the default time when the text is not a time. */
export function splitTime(time: string): { hour: number; minute: number } {
  const match = TIME.exec(time)
  return match === null
    ? { hour: 9, minute: 0 }
    : { hour: clamp(Number(match[1]), 0, 23), minute: clamp(Number(match[2]), 0, 59) }
}

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** The cron expression a plan stands for. */
export function buildCron(plan: CronPlan): string {
  switch (plan.kind) {
    case 'minutes':
      return plan.every <= 1 ? '* * * * *' : `*/${clamp(plan.every, 2, 59)} * * * *`
    case 'hourly':
      return `${clamp(plan.minute, 0, 59)} * * * *`
    case 'daily': {
      const { hour, minute } = splitTime(plan.time)
      return `${minute} ${hour} * * *`
    }
    case 'weekdays': {
      const { hour, minute } = splitTime(plan.time)
      return `${minute} ${hour} * * 1-5`
    }
    case 'weekly': {
      const { hour, minute } = splitTime(plan.time)
      const days = [...new Set(plan.days.filter((day) => day >= 0 && day <= 6))].sort((a, b) => a - b)
      return `${minute} ${hour} * * ${days.length === 0 ? '*' : days.join(',')}`
    }
    case 'monthly': {
      const { hour, minute } = splitTime(plan.time)
      return `${minute} ${hour} ${clamp(plan.day, 1, LAST_SAFE_DAY_OF_MONTH)} * *`
    }
    case 'custom':
      return plan.text.trim()
  }
}

const isNumber = (field: string): boolean => /^\d+$/.test(field)

/** The plan an expression opens as. Anything no plan can say faithfully stays `custom`. */
export function parsePlan(text: string): CronPlan {
  const parsed = parseCron(text)
  if (parsed._tag !== 'Ok') return { kind: 'custom', text }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = text.trim().split(/\s+/) as [
    string,
    string,
    string,
    string,
    string,
  ]
  if (month !== '*') return { kind: 'custom', text }

  const everyDay = dayOfMonth === '*'
  if (everyDay && hour === '*' && dayOfWeek === '*') {
    if (minute === '*') return { kind: 'minutes', every: 1 }
    const step = /^\*\/(\d+)$/.exec(minute)
    if (step !== null && (MINUTE_STEPS as readonly number[]).includes(Number(step[1])))
      return { kind: 'minutes', every: Number(step[1]) }
    if (isNumber(minute)) return { kind: 'hourly', minute: Number(minute) }
    return { kind: 'custom', text }
  }
  if (!isNumber(minute) || !isNumber(hour)) return { kind: 'custom', text }
  const time = clock(Number(hour), Number(minute))

  if (everyDay && dayOfWeek === '*') return { kind: 'daily', time }
  if (everyDay) {
    const days = [...parsed.value.daysOfWeek].sort((a, b) => a - b)
    if (days.join(',') === '1,2,3,4,5') return { kind: 'weekdays', time }
    return days.length === 7 ? { kind: 'custom', text } : { kind: 'weekly', days, time }
  }
  if (dayOfWeek === '*' && isNumber(dayOfMonth) && Number(dayOfMonth) <= LAST_SAFE_DAY_OF_MONTH)
    return { kind: 'monthly', day: Number(dayOfMonth), time }
  return { kind: 'custom', text }
}

/** The plan to show when a person switches to another kind, keeping the time they had. */
export function switchPlan(from: CronPlan, kind: CronPlanKind): CronPlan {
  if (from.kind === kind) return from
  const time = 'time' in from ? from.time : '09:00'
  switch (kind) {
    case 'minutes':
      return { kind, every: 15 }
    case 'hourly':
      return { kind, minute: 0 }
    case 'daily':
    case 'weekdays':
      return { kind, time }
    case 'weekly':
      return { kind, days: from.kind === 'weekly' ? from.days : [1], time }
    case 'monthly':
      return { kind, day: 1, time }
    case 'custom':
      return { kind, text: buildCron(from) }
  }
}

function joinNames(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

function ordinal(day: number): string {
  const tens = day % 100
  if (tens >= 11 && tens <= 13) return `${day}th`
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`
}

/** What a plan means, as the sentence a person would say. */
export function describePlan(plan: CronPlan): string {
  switch (plan.kind) {
    case 'minutes':
      return plan.every <= 1 ? 'Every minute' : `Every ${plan.every} minutes`
    case 'hourly':
      return plan.minute === 0 ? 'Every hour, on the hour' : `Every hour, ${plan.minute} minutes past the hour`
    case 'daily':
      return `Every day at ${plan.time}`
    case 'weekdays':
      return `Monday to Friday at ${plan.time}`
    case 'weekly': {
      const names = WEEKDAYS.filter((day) => plan.days.includes(day.value)).map((day) => day.name)
      return `Every ${joinNames(names)} at ${plan.time}`
    }
    case 'monthly':
      return `On the ${ordinal(plan.day)} of every month at ${plan.time}`
    case 'custom': {
      const problem = cronProblem(plan.text)
      return problem === undefined ? describeCron(plan.text) : problem
    }
  }
}

/** Why an advanced expression cannot run, or undefined when it can. */
export function cronProblem(text: string): string | undefined {
  if (text.trim() === '') return 'Type a cron expression, for example 0 9 * * 1-5.'
  const parsed = parseCron(text)
  return parsed._tag === 'Ok' ? undefined : parsed.error
}
