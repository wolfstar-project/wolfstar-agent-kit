<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import { getLocalTimeZone, parseDate, today } from '@internationalized/date'

defineOptions({ inheritAttrs: false })
const {
  id,
  label,
  disabled = false,
  required = false,
  locale = 'en-GB',
} = defineProps<{
  locale?: string
  id?: string
  label: string
  disabled?: boolean
  required?: boolean
}>()
const model = defineModel<string>({ default: '' })
const open = ref(false)
const selected = computed(() => {
  try {
    return model.value ? parseDate(model.value) : undefined
  } catch {
    return undefined
  }
})
function select(value: DateValue | undefined | null) {
  model.value = value?.toString() ?? ''
  open.value = false
}
function selectToday() {
  select(today(getLocalTimeZone()))
}
</script>

<template>
  <UInputDate
    v-bind="$attrs"
    :id="id"
    :model-value="selected"
    :disabled="disabled"
    :required="required"
    :aria-label="label"
    :locale="locale"
    granularity="day"
    class="w-full"
    :ui="{ base: 'min-h-11 pe-12', segment: 'text-base sm:text-sm' }"
    @update:model-value="model = $event?.toString() ?? ''"
  >
    <template #trailing>
      <UPopover
        v-model:open="open"
        :content="{ align: 'end', sideOffset: 8, collisionPadding: 16 }"
        :ui="{ content: 'max-h-(--reka-popover-content-available-height) overflow-y-auto' }"
      >
        <UButton
          :aria-label="`Open calendar for ${label}`"
          icon="i-octicon-calendar-16"
          variant="ghost"
          color="neutral"
          :disabled="disabled"
          class="min-h-11 min-w-11 justify-center"
        />
        <template #content>
          <div class="w-[332px] max-w-[calc(100vw-1rem)] p-3" :aria-label="`${label} calendar`">
            <UCalendar
              :model-value="selected"
              :locale="locale"
              :aria-label="label"
              :week-starts-on="1"
              prevent-deselect
              :year-controls="false"
              :prev-month="{ class: 'min-h-11 min-w-11 justify-center' }"
              :next-month="{ class: 'min-h-11 min-w-11 justify-center' }"
              :view-control="{ class: 'min-h-11' }"
              :ui="{ cellTrigger: 'm-0 size-11 text-sm', headCell: 'h-11 text-sm' }"
              @update:model-value="select"
            />
            <div class="mt-3 flex justify-between border-t border-default pt-2">
              <UButton
                label="Clear"
                color="neutral"
                variant="ghost"
                class="min-h-11"
                :disabled="required || !model"
                @click="select(undefined)"
              />
              <UButton label="Today" color="neutral" variant="ghost" class="min-h-11" @click="selectToday" />
            </div>
          </div>
        </template>
      </UPopover>
    </template>
  </UInputDate>
</template>
