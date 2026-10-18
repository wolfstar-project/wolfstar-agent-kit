<script setup lang="ts">
import type { ConfigurationField, ConfigurationIssue } from '../utils/configuration.ts'
import { configurationFields, configurationRecord, installedRepositoriesKey } from '../utils/configuration.ts'
import SettingsFields from './_SettingsFields.vue'

const props = withDefaults(
  defineProps<{
    values: Record<string, unknown>
    fields: ConfigurationField[]
    path?: string
    issues?: ConfigurationIssue[]
    includeUnknown?: boolean
    lockedPaths?: string[]
    columns?: boolean
  }>(),
  { path: '$', issues: () => [], includeUnknown: true, columns: false, lockedPaths: () => [] },
)
const emit = defineEmits<{ update: [values: Record<string, unknown>] }>()
const added = reactive<Record<string, number>>({})
const installedRepositories = inject(installedRepositoriesKey, ref<string[]>([]))
/** The App's repositories, plus a value already saved that the App does not list. */
function repositoryItems(field: ConfigurationField): string[] {
  const current = String(displayed(field) ?? '')
  return current === '' || installedRepositories.value.includes(current)
    ? installedRepositories.value
    : [current, ...installedRepositories.value]
}
const allFields = computed(() =>
  (props.includeUnknown ? configurationFields(props.values, props.fields) : props.fields).filter(
    (field) => field.visibleWhen === undefined || props.values[field.visibleWhen] === true,
  ),
)
const standard = computed(() => allFields.value.filter((field) => !field.advanced))
const advanced = computed(() =>
  allFields.value.filter((field) => field.advanced).map((field) => ({ ...field, advanced: false })),
)
const locked = (key: string): boolean => props.lockedPaths.includes(`${props.path}.${key}`)
const fieldPath = (key: string): string => `${props.path}.${key}`
const identifier = (key: string): string =>
  `configuration-${fieldPath(key)
    .slice(2)
    .replace(/[.[\]]+/g, '-')
    .replace(/-$/, '')}`
const errorFor = (key: string): string | undefined =>
  props.issues.find((issue) => issue.path === fieldPath(key) || issue.path.startsWith(`${fieldPath(key)}[`))?.message
const hasIssues = (path: string): boolean =>
  props.issues.some(
    (issue) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`),
  )
const advancedErrors = computed(() => advanced.value.some((field) => hasIssues(fieldPath(field.key))))

function set(key: string, value: unknown): void {
  const values = { ...props.values }
  if (value === undefined) delete values[key]
  else values[key] = value
  if (key === 'agent_sessions' && value === false && values.agent_sessions_codex_mode === 'full_access')
    values.agent_sessions_codex_mode = 'restricted'
  emit('update', values)
}
function displayed(field: ConfigurationField): unknown {
  return props.values[field.key] ?? ('fallback' in field ? field.fallback : undefined)
}
function stringValues(field: ConfigurationField): string[] {
  const value = displayed(field)
  return Array.isArray(value) ? value.map(String) : []
}
function entries(key: string): Record<string, unknown>[] {
  return Array.isArray(props.values[key]) ? (props.values[key] as unknown[]).map(configurationRecord) : []
}
function setEntry(key: string, index: number, value: Record<string, unknown>): void {
  set(
    key,
    entries(key).map((entry, position) => (position === index ? value : entry)),
  )
}
function addEntry(field: Extract<ConfigurationField, { kind: 'entries' }>): void {
  added[field.key] = entries(field.key).length
  set(field.key, [...entries(field.key), JSON.parse(JSON.stringify(field.initial)) as Record<string, unknown>])
}
function setGroup(field: Extract<ConfigurationField, { kind: 'object' }>, value: Record<string, unknown>): void {
  const defaults = Object.fromEntries(
    field.fields.flatMap((child) =>
      !child.optional && 'fallback' in child && child.fallback !== undefined && child.fallback !== ''
        ? [[child.key, child.fallback]]
        : [],
    ),
  )
  set(field.key, { ...(props.values[field.key] === undefined ? defaults : {}), ...value })
}
function move(field: ConfigurationField, index: number, direction: number): void {
  const values = stringValues(field)
  const other = index + direction
  if (other < 0 || other >= values.length) return
  ;[values[index], values[other]] = [values[other]!, values[index]!]
  set(field.key, values)
}
function tags(field: ConfigurationField, values: string[]): void {
  const before = props.values[field.key]
  set(
    field.key,
    Array.isArray(before) && before.some((value) => typeof value === 'number') ? values.map(Number) : values,
  )
}
function issueText(field: ConfigurationField): string {
  const value = displayed(field)
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}
</script>

<template>
  <div class="grid min-w-0 gap-6" :class="columns ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
    <template v-for="field in standard" :key="field.key">
      <fieldset
        v-if="field.kind === 'object'"
        class="min-w-0 space-y-5 border-t border-default pt-5 first:border-t-0 first:pt-0 sm:col-span-2"
      >
        <legend class="mb-4 text-sm font-medium text-highlighted">{{ field.label }}</legend>
        <div v-if="field.optional" class="flex flex-wrap gap-2">
          <UButton
            v-if="values[field.key] !== undefined"
            color="neutral"
            variant="outline"
            class="min-h-11"
            :aria-label="`Use inherited ${field.label}`"
            @click="set(field.key, undefined)"
            >Use inherited settings</UButton
          >
          <UButton
            v-if="field.key === 'release'"
            color="neutral"
            variant="outline"
            class="min-h-11"
            :aria-pressed="values[field.key] === false"
            @click="set(field.key, false)"
            >Disable inherited releases</UButton
          >
          <p v-if="values[field.key] === false" class="text-sm text-muted">Disabled.</p>
        </div>
        <SettingsFields
          :values="configurationRecord(values[field.key])"
          :fields="field.fields"
          :path="fieldPath(field.key)"
          :issues="issues"
          :locked-paths="lockedPaths"
          :columns="field.layout === 'columns'"
          @update="setGroup(field, $event)"
        />
      </fieldset>

      <fieldset v-else-if="field.kind === 'entries'" class="min-w-0 space-y-3 sm:col-span-2">
        <legend class="mb-3 text-sm font-medium text-highlighted">{{ field.label }}</legend>
        <p
          v-if="entries(field.key).length === 0"
          class="rounded-md border border-dashed border-default p-5 text-sm leading-relaxed text-muted"
        >
          {{ field.empty ?? 'No entries configured.' }}
        </p>
        <details
          v-for="(entry, index) in entries(field.key)"
          :key="index"
          :open="added[field.key] === index || hasIssues(`${fieldPath(field.key)}[${index}]`)"
          class="group min-w-0 rounded-md border border-default"
        >
          <summary
            class="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-md px-4 py-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-inverted [&::-webkit-details-marker]:hidden"
          >
            <UIcon
              name="i-octicon-chevron-right-16"
              class="size-4 shrink-0 text-muted group-open:rotate-90"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate font-medium text-highlighted">{{
              entry.github || entry.name || entry.cron || `New ${field.singular ?? 'entry'}`
            }}</span>
            <span v-if="hasIssues(`${fieldPath(field.key)}[${index}]`)" class="text-error">Needs attention</span>
            <span v-else-if="entry.enabled === false" class="text-muted">Disabled</span>
          </summary>
          <div class="space-y-5 border-t border-default p-4">
            <SettingsFields
              :values="entry"
              :fields="field.fields"
              :path="`${fieldPath(field.key)}[${index}]`"
              :issues="issues"
              :locked-paths="lockedPaths"
              @update="setEntry(field.key, index, $event)"
            />
            <UButton
              type="button"
              color="error"
              variant="ghost"
              class="min-h-11"
              :aria-label="`Remove ${field.singular ?? 'entry'} ${index + 1}`"
              @click="
                set(
                  field.key,
                  entries(field.key).filter((_, position) => position !== index),
                )
              "
              >Remove {{ field.singular ?? 'entry' }}</UButton
            >
          </div>
        </details>
        <p v-if="errorFor(field.key)" role="alert" class="text-sm text-error">{{ errorFor(field.key) }}</p>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          icon="i-octicon-plus-16"
          class="min-h-11"
          @click="addEntry(field)"
          >Add {{ field.singular ?? 'entry' }}</UButton
        >
      </fieldset>

      <div v-else-if="field.kind === 'boolean'" class="flex min-h-11 items-center justify-between gap-6 sm:col-span-2">
        <div class="min-w-0">
          <label
            :for="identifier(field.key)"
            class="flex min-h-11 cursor-pointer items-center text-sm font-medium text-highlighted"
            >{{ field.label }}</label
          >
          <p v-if="field.hint" :id="`${identifier(field.key)}-help`" class="mt-1 text-sm leading-relaxed text-muted">
            {{ field.hint }}
          </p>
          <p
            v-if="errorFor(field.key)"
            :id="`${identifier(field.key)}-error`"
            role="alert"
            class="mt-1 text-sm text-error"
          >
            {{ errorFor(field.key) }}
          </p>
        </div>
        <div class="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
          <USelect
            v-if="field.optional"
            :id="identifier(field.key)"
            :aria-label="field.label"
            :model-value="values[field.key] === undefined ? 'inherit' : values[field.key] ? 'enabled' : 'disabled'"
            :items="[
              { label: 'Inherit', value: 'inherit' },
              { label: 'Enabled', value: 'enabled' },
              { label: 'Disabled', value: 'disabled' },
            ]"
            class="min-h-11 w-32"
            @update:model-value="set(field.key, $event === 'inherit' ? undefined : $event === 'enabled')"
          />
          <USwitch
            v-else
            :id="identifier(field.key)"
            :disabled="locked(field.key)"
            :model-value="Boolean(displayed(field))"
            :aria-label="field.label"
            :aria-describedby="field.hint ? `${identifier(field.key)}-help` : undefined"
            @update:model-value="set(field.key, $event)"
          />
        </div>
      </div>

      <UFormField
        v-else
        :label="field.label"
        :description="locked(field.key) ? 'Managed by the Cloudflare deployment.' : field.hint"
        :error="errorFor(field.key)"
        :name="fieldPath(field.key)"
        :for="identifier(field.key)"
        :class="field.kind === 'number' || field.kind === 'date' ? undefined : 'sm:col-span-2'"
      >
        <div
          v-if="field.kind === 'order'"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          class="divide-y divide-default rounded-md border border-default"
          role="group"
          :aria-label="field.label"
        >
          <div
            v-for="(provider, index) in stringValues(field)"
            :key="provider"
            class="flex min-h-14 items-center gap-3 px-3"
          >
            <span class="w-4 font-mono text-sm text-muted">{{ index + 1 }}</span>
            <span class="flex-1 text-sm font-medium text-highlighted">{{
              provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : provider
            }}</span>
            <UButton
              type="button"
              variant="ghost"
              color="neutral"
              icon="i-octicon-x-16"
              class="min-h-11 min-w-11 justify-center"
              :aria-label="`Remove ${provider} from automatic order`"
              :disabled="stringValues(field).length <= 1"
              @click="
                set(
                  field.key,
                  stringValues(field).filter((value) => value !== provider),
                )
              "
            />
            <UButton
              type="button"
              variant="ghost"
              color="neutral"
              icon="i-octicon-arrow-up-16"
              class="min-h-11 min-w-11 justify-center"
              :aria-label="`Move ${provider} up`"
              :disabled="index === 0"
              @click="move(field, index, -1)"
            />
            <UButton
              type="button"
              variant="ghost"
              color="neutral"
              icon="i-octicon-arrow-down-16"
              class="min-h-11 min-w-11 justify-center"
              :aria-label="`Move ${provider} down`"
              :disabled="index === stringValues(field).length - 1"
              @click="move(field, index, 1)"
            />
          </div>
          <div v-if="field.choices.some((value) => !stringValues(field).includes(value))" class="p-3">
            <USelect
              :items="field.choices.filter((value) => !stringValues(field).includes(value))"
              placeholder="Add provider"
              :aria-label="`Add provider to ${field.label}`"
              class="min-h-11 w-full"
              @update:model-value="set(field.key, [...stringValues(field), $event])"
            />
          </div>
        </div>
        <UCheckboxGroup
          v-else-if="field.kind === 'multi-choice'"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          :model-value="stringValues(field)"
          :items="
            field.choices.map((value) => ({
              value,
              label: value === 'github' ? 'GitHub activity' : 'Scheduled routines',
            }))
          "
          :ui="{
            item: 'min-h-11 items-center',
            label: 'flex min-h-11 items-center text-sm',
            wrapper: 'min-h-11 justify-center',
          }"
          @update:model-value="set(field.key, $event)"
        />
        <USelect
          v-else-if="field.kind === 'choice'"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          :items="
            field.choices.map((value) => ({
              value,
              label: value === 'codex' ? 'Codex' : value === 'claude' ? 'Claude' : value.replaceAll('_', ' '),
            }))
          "
          :model-value="String(displayed(field))"
          class="min-h-11 w-full"
          @update:model-value="set(field.key, $event)"
        />
        <USelectMenu
          v-else-if="field.kind === 'repository' && installedRepositories.length > 0"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          :items="repositoryItems(field)"
          :model-value="String(displayed(field) ?? '')"
          :placeholder="field.placeholder"
          create-item
          class="min-h-11 w-full"
          @create="set(field.key, $event)"
          @update:model-value="set(field.key, String($event ?? ''))"
        />
        <UInputTags
          v-else-if="field.kind === 'list'"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          :model-value="stringValues(field)"
          :placeholder="field.placeholder ?? 'Add a value…'"
          class="w-full"
          :ui="{
            base: 'min-h-11 text-sm',
            itemDelete: 'relative size-6 justify-center after:absolute after:-inset-2 after:content-[\'\']',
            input: 'min-h-11',
          }"
          @update:model-value="tags(field, $event)"
        />
        <div v-else-if="field.kind === 'checks'" class="space-y-3">
          <USelect
            :id="identifier(field.key)"
            :model-value="values[field.key] === 'all' ? 'all' : 'selected'"
            :items="[
              { label: 'All checks', value: 'all' },
              { label: 'Selected checks', value: 'selected' },
            ]"
            aria-label="Check selection"
            class="min-h-11 w-full"
            @update:model-value="set(field.key, $event === 'all' ? 'all' : [])"
          />
          <UInputTags
            v-if="values[field.key] !== 'all'"
            :model-value="stringValues(field)"
            :aria-label="field.label"
            class="w-full"
            :ui="{ base: 'min-h-11' }"
            @update:model-value="set(field.key, $event)"
          />
        </div>
        <UInput
          v-else-if="field.kind === 'issues'"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          :model-value="issueText(field)"
          placeholder="all or 658, 700"
          class="w-full"
          :ui="{ base: 'min-h-11' }"
          @update:model-value="
            set(field.key, String($event).trim() === 'all' ? 'all' : String($event).split(',').map(Number))
          "
        />
        <UiDatePicker
          v-else-if="field.kind === 'date'"
          :id="identifier(field.key)"
          :model-value="String(displayed(field) ?? '')"
          :label="field.label"
          :disabled="locked(field.key)"
          :required="!field.optional"
          @update:model-value="set(field.key, $event)"
        />
        <UInput
          v-else-if="field.kind === 'number'"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step ?? 1"
          :model-value="values[field.key] as number | undefined"
          :placeholder="String(displayed(field) ?? 'Automatic')"
          class="w-full sm:max-w-48"
          :ui="{ base: 'min-h-11 font-mono' }"
          @update:model-value="set(field.key, $event === '' ? undefined : Number($event))"
        />
        <UTextarea
          v-else-if="field.kind === 'multiline'"
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          :model-value="String(displayed(field) ?? '')"
          :rows="4"
          class="w-full"
          @update:model-value="set(field.key, String($event))"
        />
        <UInput
          v-else
          :id="identifier(field.key)"
          :disabled="locked(field.key)"
          type="text"
          :model-value="String(displayed(field) ?? '')"
          :placeholder="field.placeholder"
          class="w-full"
          :ui="{ base: 'min-h-11' }"
          spellcheck="false"
          @update:model-value="set(field.key, String($event))"
        />
        <UButton
          v-if="field.optional && values[field.key] !== undefined && !locked(field.key)"
          color="neutral"
          variant="ghost"
          class="mt-2 min-h-11"
          :aria-label="`Use default ${field.label}`"
          @click="set(field.key, undefined)"
          >Use default</UButton
        >
      </UFormField>
    </template>

    <details v-if="advanced.length" :open="advancedErrors" class="min-w-0 border-t border-default pt-2 sm:col-span-2">
      <summary
        class="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted hover:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted"
      >
        Advanced options <span v-if="advancedErrors" class="text-error">· Needs attention</span>
      </summary>
      <div class="pt-4">
        <SettingsFields
          :values="values"
          :fields="advanced"
          :path="path"
          :issues="issues"
          :locked-paths="lockedPaths"
          :include-unknown="false"
          @update="emit('update', $event)"
        />
      </div>
    </details>
  </div>
</template>
