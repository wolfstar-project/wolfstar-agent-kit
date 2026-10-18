<script setup lang="ts">
import type { ConfigurationIssue, ConfigurationSectionId, ConfigurationView } from '../utils/configuration.ts'
import { useEventListener } from '@vueuse/core'
import {
  CONFIGURATION_SECTIONS,
  configurationFailure,
  installedRepositoriesKey,
  configurationIssueSection,
  configurationSectionFields,
} from '../utils/configuration.ts'
import SettingsFields from './_SettingsFields.vue'
import SettingsAccount from './_SettingsAccount.vue'

type LoadState = { _tag: 'Loading' } | { _tag: 'Failed'; message: string } | { _tag: 'Ready'; view: ConfigurationView }
const state = ref<LoadState>({ _tag: 'Loading' })
const draft = ref<Record<string, unknown>>({})
const slots = useSlots()
const sections = CONFIGURATION_SECTIONS
const active = ref<ConfigurationSectionId>('automation')
/** Settings the Cloudflare deployment keeps, opened from inside the section they belong to. */
const SUBSECTIONS = [
  {
    id: 'providers',
    section: 'agents',
    label: 'Provider logins',
    description: 'Sign in to Claude, Codex, GLM and Workers AI for the Cloudflare deployment.',
  },
  {
    id: 'github-account',
    section: 'github',
    label: 'GitHub App and your account',
    description: 'Install the App on more repositories, connect your own account, and allow writes.',
  },
] as const
type SubsectionId = (typeof SUBSECTIONS)[number]['id']
const subsection = ref<SubsectionId>()
const entries = computed(() =>
  SUBSECTIONS.filter((entry) => entry.section === active.value && slots[entry.id] !== undefined),
)
const opened = computed(() => SUBSECTIONS.find((entry) => entry.id === subsection.value))
watch(active, () => {
  subsection.value = undefined
})
function showIssue(path: string): void {
  active.value = configurationIssueSection(path)
  subsection.value = undefined
}
async function openSubsection(id: SubsectionId): Promise<void> {
  subsection.value = id
  await nextTick()
  document.getElementById('settings-subsection-title')?.focus()
}
async function closeSubsection(): Promise<void> {
  const id = subsection.value
  subsection.value = undefined
  await nextTick()
  document.getElementById(`settings-entry-${id}`)?.focus()
}
const saving = ref(false)
const problem = ref<{ message: string; issues: ConfigurationIssue[] }>()
const needsRestart = ref(false)
const reloadOpen = ref(false)
const toast = useToast()
const { snapshot, controlPending, requestRestart } = useDashboard()
const view = computed(() => (state.value._tag === 'Ready' ? state.value.view : undefined))
const dirty = computed(
  () => view.value !== undefined && JSON.stringify(draft.value) !== JSON.stringify(view.value.values),
)
const section = computed(() => CONFIGURATION_SECTIONS.find((section) => section.id === active.value)!)
const fields = computed(() => configurationSectionFields(active.value, draft.value))
const restartActive = computed(
  () => snapshot.value.restartRequest?._tag === 'Requested' || snapshot.value.restartRequest?._tag === 'Restarting',
)
const sectionErrors = (id: ConfigurationSectionId): boolean =>
  problem.value?.issues.some((issue) => configurationIssueSection(issue.path) === id) ?? false

async function load(): Promise<void> {
  state.value = { _tag: 'Loading' }
  problem.value = undefined
  reloadOpen.value = false
  try {
    const loaded = await $fetch<ConfigurationView>('/api/configuration')
    state.value = { _tag: 'Ready', view: loaded }
    draft.value = JSON.parse(JSON.stringify(loaded.values)) as Record<string, unknown>
  } catch (error) {
    state.value = { _tag: 'Failed', message: configurationFailure(error).message }
  }
}
function reload(): void {
  if (dirty.value) reloadOpen.value = true
  else void load()
}
async function save(): Promise<void> {
  if (!view.value || saving.value) return
  saving.value = true
  problem.value = undefined
  try {
    const saved = await $fetch<ConfigurationView>('/api/configuration', {
      method: 'POST',
      body: { revision: view.value.revision, values: draft.value },
    })
    state.value = { _tag: 'Ready', view: saved }
    draft.value = JSON.parse(JSON.stringify(saved.values)) as Record<string, unknown>
    needsRestart.value = true
    toast.add({
      title: 'Configuration saved',
      description: 'Restart after current work to apply it.',
      color: 'success',
    })
  } catch (error) {
    problem.value = configurationFailure(error)
    const first = problem.value.issues[0]
    if (first) showIssue(first.path)
  } finally {
    saving.value = false
  }
  if (problem.value?.issues.length) {
    await nextTick()
    document.querySelector<HTMLElement>('[data-settings-fields] [aria-invalid="true"]')?.focus()
  }
}
/** The repositories the GitHub App sees. A failed read leaves the repository fields as plain text. */
const installedRepositories = ref<string[]>([])
provide(installedRepositoriesKey, installedRepositories)
async function loadInstalledRepositories(): Promise<void> {
  try {
    installedRepositories.value = (await $fetch<{ repositories: string[] }>('/api/installed-repositories')).repositories
  } catch {
    installedRepositories.value = []
  }
}
onMounted(() => {
  void load()
  void loadInstalledRepositories()
})
onBeforeRouteLeave(() => !dirty.value || window.confirm('Leave without saving configuration changes?'))
useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (dirty.value) event.preventDefault()
})
</script>

<template>
  <section aria-label="Service configuration" class="flex min-h-[calc(100dvh-8rem)] min-w-0 flex-col">
    <div
      v-if="state._tag === 'Loading'"
      class="grid gap-8 md:grid-cols-[11rem_minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading configuration"
    >
      <div class="hidden space-y-3 md:block"><UiSkeleton v-for="index in 6" :key="index" class="h-11 w-full" /></div>
      <div class="space-y-6">
        <UiSkeleton class="h-8 w-40" /><UiSkeleton class="h-24 w-full" /><UiSkeleton class="h-44 w-full" />
      </div>
    </div>
    <UAlert
      v-else-if="state._tag === 'Failed'"
      color="error"
      variant="outline"
      title="Configuration could not be loaded"
      :description="state.message"
      :actions="[{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: load }]"
    />

    <template v-else-if="view">
      <div class="grid min-w-0 flex-1 content-start gap-6 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
        <aside class="min-w-0">
          <UFormField label="Settings section" class="md:hidden">
            <USelect
              v-model="active"
              :items="
                sections.map((section) => ({
                  label: section.label,
                  value: section.id,
                  icon: section.icon,
                }))
              "
              aria-label="Settings section"
              class="min-h-11 w-full"
            />
          </UFormField>
          <nav aria-label="Settings sections" class="hidden space-y-1 md:block">
            <UButton
              v-for="item in sections"
              :key="item.id"
              type="button"
              color="neutral"
              variant="ghost"
              :icon="item.icon"
              class="min-h-11 w-full justify-start text-sm"
              :class="active === item.id ? 'bg-muted text-highlighted' : 'text-muted'"
              :aria-current="active === item.id ? 'page' : undefined"
              @click="active = item.id"
            >
              {{ item.label }}
              <UIcon
                v-if="sectionErrors(item.id)"
                name="i-octicon-alert-16"
                class="ms-auto size-4 text-error"
                aria-label="Contains errors"
              />
            </UButton>
          </nav>
          <details class="mt-5 hidden border-t border-default pt-3 text-sm md:block">
            <summary class="flex min-h-11 cursor-pointer items-center text-muted hover:text-highlighted">
              Configuration file
            </summary>
            <code class="block break-all pb-2 text-sm leading-relaxed text-muted">{{ view.path }}</code>
          </details>
        </aside>

        <div class="min-w-0">
          <header class="mb-7 flex items-start justify-between gap-4 border-b border-default pb-5">
            <div>
              <h1 class="text-lg font-medium text-highlighted">{{ section.label }}</h1>
              <p class="mt-1 max-w-lg text-sm leading-relaxed text-muted">{{ section.description }}</p>
            </div>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-octicon-sync-16"
              aria-label="Reload configuration"
              class="min-h-11 min-w-11 shrink-0 justify-center"
              :disabled="saving"
              @click="reload"
            />
          </header>

          <div v-if="problem" role="alert" class="mb-6 space-y-2 rounded-md border border-error/40 p-4 text-sm">
            <p class="font-medium text-error">Changes were not saved.</p>
            <p class="leading-relaxed text-muted">
              {{
                problem.issues.length
                  ? 'Review the highlighted fields. Your saved configuration has not changed.'
                  : problem.message
              }}
            </p>
            <ul v-if="problem.issues.length" class="space-y-1">
              <li v-for="issue in problem.issues" :key="`${issue.path}-${issue.message}`">
                <button
                  type="button"
                  class="min-h-11 text-start text-error underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-inverted"
                  @click="showIssue(issue.path)"
                >
                  {{ issue.message }}
                </button>
              </li>
            </ul>
            <UButton v-else type="button" color="neutral" variant="outline" class="min-h-11" @click="reload"
              >Reload configuration</UButton
            >
          </div>

          <SettingsAccount v-if="active === 'account'" />
          <div v-else-if="opened" class="space-y-5">
            <UButton
              :label="`Back to ${section.label}`"
              icon="i-octicon-arrow-left-16"
              color="neutral"
              variant="ghost"
              class="min-h-11"
              @click="closeSubsection"
            />
            <h2
              id="settings-subsection-title"
              tabindex="-1"
              class="text-base font-medium text-highlighted outline-none"
            >
              {{ opened.label }}
            </h2>
            <slot :name="opened.id" />
          </div>
          <template v-else>
            <div v-if="entries.length" class="mb-7 space-y-3">
              <UButton
                v-for="entry in entries"
                :id="`settings-entry-${entry.id}`"
                :key="entry.id"
                color="neutral"
                variant="outline"
                class="min-h-16 w-full justify-between gap-4 p-4 text-start"
                :aria-label="`Open ${entry.label}`"
                @click="openSubsection(entry.id)"
              >
                <span class="min-w-0 space-y-1 whitespace-normal">
                  <span class="block text-sm font-medium text-highlighted">{{ entry.label }}</span>
                  <span class="block text-sm font-normal text-muted">{{ entry.description }}</span>
                </span>
                <UIcon name="i-octicon-chevron-right-16" class="size-4 shrink-0 text-muted" aria-hidden="true" />
              </UButton>
            </div>
          </template>
          <form
            v-show="active !== 'account' && !opened"
            id="local-configuration-form"
            novalidate
            @submit.prevent="save"
          >
            <fieldset :disabled="saving" data-settings-fields class="min-w-0">
              <SettingsFields
                :key="active"
                :values="draft"
                :fields="fields"
                :issues="problem?.issues ?? []"
                :locked-paths="view.managedPaths ?? []"
                :include-unknown="false"
                @update="draft = $event"
              />
            </fieldset>
          </form>
          <p
            v-if="active === 'agents' && !opened"
            class="mt-6 border-t border-default pt-4 text-sm leading-relaxed text-muted"
          >
            A pinned Agent selection overrides these defaults.
            {{ slots.providers ? '' : 'Provider logins stay on this machine.' }}
          </p>
        </div>
      </div>

      <footer
        v-if="dirty || saving || needsRestart || restartActive"
        class="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-4 py-3 shadow-lg"
        aria-label="Configuration actions"
      >
        <p class="text-sm text-muted" role="status" aria-live="polite">
          {{
            saving
              ? 'Saving changes…'
              : dirty
                ? 'Unsaved changes'
                : restartActive
                  ? 'Restart requested. Current work will finish first.'
                  : needsRestart
                    ? 'Saved. Restart to apply.'
                    : 'No unsaved changes'
          }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="needsRestart"
            type="button"
            color="neutral"
            variant="outline"
            class="min-h-11"
            :loading="controlPending"
            :disabled="dirty || saving || controlPending || restartActive"
            @click="requestRestart"
            >Restart after current work</UButton
          >
          <UButton
            type="submit"
            form="local-configuration-form"
            class="min-h-11"
            :loading="saving"
            :disabled="!dirty || saving || restartActive"
            >Save changes</UButton
          >
        </div>
      </footer>
      <ConfirmModal
        v-model:open="reloadOpen"
        title="Discard unsaved changes?"
        consequence="Reload the configuration file and discard your unsaved edits in every section."
        confirm-label="Discard and reload"
        tone="primary"
        @confirm="load"
      />
    </template>
  </section>
</template>
