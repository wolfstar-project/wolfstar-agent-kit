<script setup lang="ts">
import type { ProviderDescription, ProviderField } from '../utils/settings.ts'
import {
  canRemoveProvider,
  codexLoginProblem,
  isProviderConfigured,
  PROVIDERS,
  removeChanges,
  saveChanges,
} from '../utils/settings.ts'
import SettingsCodexLogin from './_SettingsCodexLogin.vue'

/**
 * What the Cloudflare edge Worker keeps for the Service: Agent provider
 * logins, and the GitHub App and account it acts as.
 *
 * The Worker keeps these logins, so this reads and writes them through it.
 * Settings opens each part from inside the section it belongs to.
 */
defineProps<{ part: 'providers' | 'github' }>()

const settings = useSettings()
const { view, saving, saveError, restarting } = settings

/** What a person typed and has not saved yet, by field. */
const drafts = reactive<Partial<Record<ProviderField['key'], string>>>({})
const maintainerDraft = ref('')

function problem(provider: ProviderDescription): string | null {
  return provider.id === 'codex' ? codexLoginProblem(drafts.codexAuth ?? '') : null
}

function canSave(provider: ProviderDescription): boolean {
  return Object.keys(saveChanges(provider.id, drafts)).length > 0 && problem(provider) === null && !saving.value
}

async function saveProvider(provider: ProviderDescription): Promise<void> {
  if (!(await settings.save(saveChanges(provider.id, drafts)))) return
  for (const field of provider.fields) drafts[field.key] = ''
}

async function removeProvider(provider: ProviderDescription): Promise<void> {
  await settings.save(removeChanges(provider.id))
}

async function saveMaintainer(): Promise<void> {
  if (await settings.save({ githubUserToken: maintainerDraft.value })) maintainerDraft.value = ''
}

async function setWrites(enabled: boolean): Promise<void> {
  await settings.save({ mutationsEnabled: enabled })
}
</script>
<template>
  <div v-if="view" class="space-y-8">
    <UAlert
      v-if="restarting"
      color="info"
      variant="subtle"
      icon="i-octicon-sync-16"
      title="Saved. The controller is restarting."
      description="It starts on the new settings in about a minute, and the dashboard reconnects on its own."
    />
    <UAlert
      v-if="saveError !== undefined"
      color="error"
      variant="subtle"
      title="That change was not saved."
      :description="saveError"
    />

    <section v-if="part === 'providers'" aria-label="Agent providers" class="space-y-3">
      <p class="text-sm text-muted">Each one runs on its own subscription. Keep at least one.</p>
      <UiCard v-for="provider in PROVIDERS" :key="provider.id" :title="provider.title" size="md">
        <template #actions>
          <UiStatusBadge
            :status="isProviderConfigured(view, provider.id) ? 'success' : 'neutral'"
            :label="isProviderConfigured(view, provider.id) ? 'Connected' : 'Not set'"
          />
        </template>
        <p class="text-sm text-muted">{{ provider.summary }}</p>
        <p class="mt-1 text-sm text-muted">{{ provider.source }}</p>
        <SettingsCodexLogin
          v-if="provider.id === 'codex'"
          class="mt-4"
          :configured="isProviderConfigured(view, provider.id)"
        />
        <component
          :is="provider.id === 'codex' ? 'details' : 'div'"
          :class="provider.id === 'codex' ? 'mt-4 border-t border-default pt-3' : undefined"
        >
          <summary
            v-if="provider.id === 'codex'"
            class="flex min-h-11 cursor-pointer items-center text-sm text-muted hover:text-highlighted"
          >
            Paste auth.json instead
          </summary>
          <form class="mt-4 space-y-3" @submit.prevent="saveProvider(provider)">
            <UFormField
              v-for="field in provider.fields"
              :key="field.key"
              :label="field.label"
              :help="field.hint"
              :error="field.key === 'codexAuth' ? (problem(provider) ?? undefined) : undefined"
            >
              <UTextarea
                v-if="field.multiline"
                v-model="drafts[field.key]"
                :rows="4"
                autocomplete="off"
                spellcheck="false"
                class="w-full font-mono"
                :placeholder="isProviderConfigured(view, provider.id) ? 'Saved. Paste a new one to replace it.' : ''"
              />
              <UInput
                v-else
                v-model="drafts[field.key]"
                :type="field.key === 'workersAiAccountId' ? 'text' : 'password'"
                autocomplete="off"
                spellcheck="false"
                class="w-full"
                :placeholder="
                  field.key === 'workersAiAccountId' && view.providers.workersAi.accountId !== null
                    ? view.providers.workersAi.accountId
                    : isProviderConfigured(view, provider.id)
                      ? 'Saved. Enter a new one to replace it.'
                      : ''
                "
              />
            </UFormField>
            <div class="flex items-center gap-2">
              <UButton
                type="submit"
                size="sm"
                color="neutral"
                variant="outline"
                :label="isProviderConfigured(view, provider.id) ? 'Replace' : 'Connect'"
                :loading="saving"
                :disabled="!canSave(provider)"
              />
              <ConfirmButton
                v-if="canRemoveProvider(view, provider.id)"
                label="Remove"
                confirm-label="Remove it?"
                :aria-label="`Remove ${provider.title}`"
                :confirm-aria-label="`Confirm removing ${provider.title}`"
                icon="i-octicon-trash-16"
                :loading="saving"
                :disabled="saving"
                @confirm="removeProvider(provider)"
              />
            </div>
          </form>
        </component>
      </UiCard>
    </section>

    <section v-if="part === 'github'" aria-label="GitHub" class="space-y-3">
      <p class="text-sm text-muted">The App the Service acts as, and your own account for what an App cannot do.</p>
      <UiCard v-if="view.app !== null" title="GitHub App" size="md">
        <UiFactsGrid
          :columns="2"
          :facts="[
            { label: 'App', value: view.app.slug, mono: true },
            { label: 'Owner', value: view.app.owner },
          ]"
        />
        <div class="mt-4">
          <UButton
            :to="view.app.installUrl"
            target="_blank"
            rel="noopener"
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-octicon-link-external-16"
            label="Install on more repositories"
          />
          <p class="mt-2 text-sm text-muted">
            The controller clones a new repository the next time it starts, so save a setting after installing.
          </p>
        </div>
      </UiCard>

      <UiCard title="Your GitHub account" size="md">
        <template #actions>
          <UiStatusBadge
            :status="view.githubUser !== null ? 'success' : 'neutral'"
            :label="view.githubUser !== null ? `Signed in as ${view.githubUser.login}` : 'Not set'"
          />
        </template>
        <p class="text-sm text-muted">
          Comment commands, diagrams in pull requests, and workflow merges on contributor forks use your own account.
          Create a classic token with the repo, workflow, and read:org scopes.
        </p>
        <form class="mt-4 space-y-3" @submit.prevent="saveMaintainer">
          <UFormField label="Token" help="Starts with ghp_ or github_pat_">
            <UInput
              v-model="maintainerDraft"
              type="password"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
              :placeholder="view.githubUser !== null ? 'Saved. Enter a new one to replace it.' : ''"
            />
          </UFormField>
          <div class="flex items-center gap-2">
            <UButton
              type="submit"
              size="sm"
              color="neutral"
              variant="outline"
              :label="view.githubUser !== null ? 'Replace' : 'Connect'"
              :loading="saving"
              :disabled="maintainerDraft.trim() === '' || saving"
            />
            <ConfirmButton
              v-if="view.githubUser !== null"
              label="Remove"
              confirm-label="Remove it?"
              aria-label="Remove your GitHub account"
              confirm-aria-label="Confirm removing your GitHub account"
              icon="i-octicon-trash-16"
              :loading="saving"
              :disabled="saving"
              @confirm="settings.save({ githubUserToken: null })"
            />
          </div>
        </form>
      </UiCard>
    </section>

    <section v-if="part === 'github'" aria-label="Writes to GitHub" class="space-y-3">
      <UiSectionHeader id="settings-writes" title="Writes to GitHub" icon="i-octicon-shield-16" />
      <UiCard size="md">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-highlighted">Let the Agent write to GitHub</p>
            <p class="mt-0.5 text-sm text-muted">
              Comments, labels, pull requests, and pushes. Off, the Service reads and reviews but changes nothing.
            </p>
          </div>
          <USwitch
            :model-value="view.mutationsEnabled"
            :disabled="saving"
            aria-label="Let the Agent write to GitHub"
            @update:model-value="setWrites"
          />
        </div>
      </UiCard>
    </section>
  </div>
</template>
