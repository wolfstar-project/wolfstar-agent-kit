import type { CronPlan } from '../dashboard/app/utils/cron-builder.ts'
import { describe, expect, it } from 'vitest'
import {
  buildCron,
  cronProblem,
  describePlan,
  MINUTE_STEPS,
  parsePlan,
  switchPlan,
} from '../dashboard/app/utils/cron-builder.ts'
import { parseCron } from '../src/routine-schedule.ts'

describe('buildCron', () => {
  it.each<[CronPlan, string]>([
    [{ kind: 'minutes', every: 1 }, '* * * * *'],
    [{ kind: 'minutes', every: 15 }, '*/15 * * * *'],
    [{ kind: 'hourly', minute: 30 }, '30 * * * *'],
    [{ kind: 'daily', time: '09:05' }, '5 9 * * *'],
    [{ kind: 'weekdays', time: '18:30' }, '30 18 * * 1-5'],
    [{ kind: 'weekly', days: [5, 1, 1], time: '07:00' }, '0 7 * * 1,5'],
    [{ kind: 'weekly', days: [0], time: '07:00' }, '0 7 * * 0'],
    [{ kind: 'monthly', day: 15, time: '06:00' }, '0 6 15 * *'],
    [{ kind: 'custom', text: '  0 9 * * 1-5 ' }, '0 9 * * 1-5'],
  ])('writes %j as %s', (plan, expression) => {
    expect(buildCron(plan)).toBe(expression)
  })

  it('keeps a monthly day inside the days every month has', () => {
    expect(buildCron({ kind: 'monthly', day: 31, time: '06:00' })).toBe('0 6 28 * *')
  })

  it('only writes expressions the service accepts', () => {
    const plans: CronPlan[] = [
      ...MINUTE_STEPS.map((every): CronPlan => ({ kind: 'minutes', every })),
      { kind: 'hourly', minute: 59 },
      { kind: 'daily', time: '23:59' },
      { kind: 'weekdays', time: '00:00' },
      { kind: 'weekly', days: [0, 6], time: '12:00' },
      { kind: 'monthly', day: 1, time: '12:00' },
    ]
    for (const plan of plans) expect(parseCron(buildCron(plan))._tag).toBe('Ok')
  })
})

describe('parsePlan', () => {
  it.each<[string, CronPlan]>([
    ['* * * * *', { kind: 'minutes', every: 1 }],
    ['*/10 * * * *', { kind: 'minutes', every: 10 }],
    ['45 * * * *', { kind: 'hourly', minute: 45 }],
    ['0 7 * * *', { kind: 'daily', time: '07:00' }],
    ['30 9 * * 1-5', { kind: 'weekdays', time: '09:30' }],
    ['30 9 * * 1,2,3,4,5', { kind: 'weekdays', time: '09:30' }],
    ['0 6 * * 5,1', { kind: 'weekly', days: [1, 5], time: '06:00' }],
    ['0 6 * * 7', { kind: 'weekly', days: [0], time: '06:00' }],
    ['0 6 15 * *', { kind: 'monthly', day: 15, time: '06:00' }],
  ])('opens %s as a plan', (expression, plan) => {
    expect(parsePlan(expression)).toEqual(plan)
  })

  it.each([
    '*/7 * * * *',
    '0 */2 * * *',
    '0 6,18 * * *',
    '0 7 1 6 *',
    '0 7 31 * *',
    '0 7 1 * 1',
    '0 7 * * 0-6',
    'oops',
  ])('keeps %s as an expression to edit', (expression) => {
    expect(parsePlan(expression)).toEqual({ kind: 'custom', text: expression })
  })

  it('round-trips every plan the builder can make', () => {
    const plans: CronPlan[] = [
      { kind: 'minutes', every: 30 },
      { kind: 'hourly', minute: 5 },
      { kind: 'daily', time: '08:15' },
      { kind: 'weekdays', time: '08:15' },
      { kind: 'weekly', days: [0, 2, 4], time: '08:15' },
      { kind: 'monthly', day: 28, time: '08:15' },
    ]
    for (const plan of plans) expect(parsePlan(buildCron(plan))).toEqual(plan)
  })
})

describe('switchPlan', () => {
  it('keeps the time a person already chose', () => {
    expect(switchPlan({ kind: 'daily', time: '17:45' }, 'weekdays')).toEqual({ kind: 'weekdays', time: '17:45' })
    expect(switchPlan({ kind: 'weekly', days: [3], time: '17:45' }, 'monthly')).toEqual({
      kind: 'monthly',
      day: 1,
      time: '17:45',
    })
  })

  it('offers the current expression for editing when going advanced', () => {
    expect(switchPlan({ kind: 'weekdays', time: '09:00' }, 'custom')).toEqual({ kind: 'custom', text: '0 9 * * 1-5' })
  })
})

describe('describePlan', () => {
  it.each<[CronPlan, string]>([
    [{ kind: 'minutes', every: 1 }, 'Every minute'],
    [{ kind: 'minutes', every: 15 }, 'Every 15 minutes'],
    [{ kind: 'hourly', minute: 0 }, 'Every hour, on the hour'],
    [{ kind: 'hourly', minute: 20 }, 'Every hour, 20 minutes past the hour'],
    [{ kind: 'daily', time: '09:00' }, 'Every day at 09:00'],
    [{ kind: 'weekdays', time: '09:00' }, 'Monday to Friday at 09:00'],
    [{ kind: 'weekly', days: [0, 1, 5], time: '09:00' }, 'Every Monday, Friday and Sunday at 09:00'],
    [{ kind: 'monthly', day: 1, time: '09:00' }, 'On the 1st of every month at 09:00'],
    [{ kind: 'monthly', day: 22, time: '09:00' }, 'On the 22nd of every month at 09:00'],
    [{ kind: 'monthly', day: 11, time: '09:00' }, 'On the 11th of every month at 09:00'],
  ])('says %j', (plan, sentence) => {
    expect(describePlan(plan)).toBe(sentence)
  })

  it('names the problem with an advanced expression', () => {
    expect(describePlan({ kind: 'custom', text: '0 9 * *' })).toBe(
      'Write five cron fields: minute, hour, day of month, month, and day of week.',
    )
    expect(cronProblem('')).toContain('Type a cron expression')
    expect(cronProblem('0 9 * * 1-5')).toBeUndefined()
  })
})
