<script setup lang="ts">
import type { CronPlan, CronPlanKind } from '../utils/cron-builder.ts'
import {
  buildCron,
  CRON_PLAN_LABELS,
  cronProblem,
  DEFAULT_CRON_PLAN,
  describePlan,
  LAST_SAFE_DAY_OF_MONTH,
  MINUTE_STEPS,
  parsePlan,
  switchPlan,
  WEEKDAYS,
} from '../utils/cron-builder.ts'

/**
 * Builds one cron expression from choices, so nobody has to know the syntax.
 * The model stays the expression, which is what the configuration stores.
 */
const { id, label, disabled = false } = defineProps<{ id?: string; label: string; disabled?: boolean }>()
const model = defineModel<string>({ default: '' })

const plan = ref<CronPlan>(model.value.trim() === '' ? DEFAULT_CRON_PLAN : parsePlan(model.value))
// An outside change, such as a reload, reopens as the plan it says. A change made
// here is already the plan, so it must not reopen as another plan mid-edit.
watch(model, (value) => {
  if (value.trim() !== buildCron(plan.value)) plan.value = parsePlan(value)
})
// A new schedule starts with a working default, so saving never sends an empty one.
onMounted(() => {
  if (model.value.trim() === '') model.value = buildCron(plan.value)
})

const kinds = Object.entries(CRON_PLAN_LABELS).map(([value, text]) => ({ value, label: text }))
const minuteChoices = MINUTE_STEPS.map((step) => ({ value: step, label: step === 1 ? 'minute' : `${step} minutes` }))
const daysOfMonth = Array.from({ length: LAST_SAFE_DAY_OF_MONTH }, (_, index) => ({
  value: index + 1,
  label: String(index + 1),
}))
const problem = computed(() => (plan.value.kind === 'custom' ? cronProblem(plan.value.text) : undefined))
const sentence = computed(() => describePlan(plan.value))

function update(next: CronPlan): void {
  plan.value = next
  model.value = buildCron(next)
}
function chooseKind(kind: CronPlanKind): void {
  update(switchPlan(plan.value, kind))
}
function toggleDay(day: number): void {
  if (plan.value.kind !== 'weekly') return
  const days = plan.value.days.includes(day)
    ? plan.value.days.filter((value) => value !== day)
    : [...plan.value.days, day]
  // A weekly schedule with no day would never run, so the last day stays on.
  if (days.length > 0) update({ ...plan.value, days })
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <UFormField label="How often should it run?" :for="id">
      <USelect
        :id="id"
        :model-value="plan.kind"
        :items="kinds"
        :disabled="disabled"
        :aria-label="`${label}: how often`"
        class="min-h-11 w-full"
        @update:model-value="chooseKind($event as CronPlanKind)"
      />
    </UFormField>

    <UFormField v-if="plan.kind === 'minutes'" label="Run every">
      <USelect
        :model-value="plan.every"
        :items="minuteChoices"
        :disabled="disabled"
        aria-label="Minutes between runs"
        class="min-h-11 w-full sm:max-w-56"
        @update:model-value="update({ kind: 'minutes', every: Number($event) })"
      />
    </UFormField>

    <UFormField
      v-else-if="plan.kind === 'hourly'"
      label="Minutes past the hour"
      description="0 runs on the hour, 30 at half past."
    >
      <UInput
        type="number"
        :min="0"
        :max="59"
        :model-value="plan.minute"
        :disabled="disabled"
        class="w-full sm:max-w-32"
        :ui="{ base: 'min-h-11 font-mono' }"
        @update:model-value="update({ kind: 'hourly', minute: Number($event) })"
      />
    </UFormField>

    <template v-else-if="plan.kind !== 'custom'">
      <UFormField v-if="plan.kind === 'weekly'" label="On which days?">
        <div class="flex flex-wrap gap-2" role="group" aria-label="Days of the week">
          <UButton
            v-for="day in WEEKDAYS"
            :key="day.value"
            type="button"
            :label="day.label"
            :aria-label="day.name"
            :aria-pressed="plan.days.includes(day.value)"
            :color="plan.days.includes(day.value) ? 'primary' : 'neutral'"
            :variant="plan.days.includes(day.value) ? 'solid' : 'outline'"
            :disabled="disabled"
            class="min-h-11 min-w-12 justify-center"
            @click="toggleDay(day.value)"
          />
        </div>
      </UFormField>

      <UFormField
        v-else-if="plan.kind === 'monthly'"
        label="On which day of the month?"
        description="Up to the 28th, so every month has it."
      >
        <USelect
          :model-value="plan.day"
          :items="daysOfMonth"
          :disabled="disabled"
          aria-label="Day of the month"
          class="min-h-11 w-full sm:max-w-32"
          @update:model-value="update({ ...plan, day: Number($event) })"
        />
      </UFormField>

      <UFormField label="At what time?" description="In the time zone chosen for this routine.">
        <UInput
          type="time"
          :model-value="plan.time"
          :disabled="disabled"
          class="w-full sm:max-w-40"
          :ui="{ base: 'min-h-11 font-mono' }"
          @update:model-value="$event !== '' && update({ ...plan, time: String($event) })"
        />
      </UFormField>
    </template>

    <UFormField
      v-else
      label="Cron expression"
      description="Five fields: minute, hour, day of month, month, day of week. Example: 0 9 * * 1-5."
      :error="problem"
    >
      <UInput
        type="text"
        :model-value="plan.text"
        :disabled="disabled"
        placeholder="0 9 * * 1-5"
        spellcheck="false"
        class="w-full"
        :ui="{ base: 'min-h-11 font-mono' }"
        @update:model-value="update({ kind: 'custom', text: String($event) })"
      />
    </UFormField>

    <p v-if="problem === undefined" class="rounded-md bg-muted px-3 py-2 text-sm text-highlighted" aria-live="polite">
      <span class="text-muted">Runs:</span> {{ sentence }}
      <code v-if="plan.kind !== 'custom'" class="ml-2 font-mono text-xs text-muted">{{ buildCron(plan) }}</code>
    </p>
  </div>
</template>
