<script setup lang="ts">
import type { CodexCode } from '../utils/settings.ts'
import { useClipboard } from '@vueuse/core'

/**
 * Codex sign in with a one-time code, the flow `codex login --device-auth` runs.
 *
 * The Worker gets the code from OpenAI and saves the login once the person
 * approves it, so the page only shows the code and asks again on OpenAI's
 * interval until it is approved, refused, or expired.
 */
const props = defineProps<{ configured: boolean }>()

type Flow =
  | { _tag: 'Idle' }
  | { _tag: 'Requesting' }
  | { _tag: 'Waiting'; code: CodexCode }
  | { _tag: 'Failed'; reason: string }

const settings = useSettings()
const flow = ref<Flow>({ _tag: 'Idle' })
const { copy, copied, isSupported: clipboardSupported } = useClipboard()
let timer: ReturnType<typeof setTimeout> | undefined

function stop(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}

function schedule(code: CodexCode): void {
  stop()
  timer = setTimeout(() => void poll(code), code.interval * 1000)
}

/** Whether the page still shows this code. A reactive copy is never the same object, so compare the id. */
function showing(code: CodexCode): boolean {
  return flow.value._tag === 'Waiting' && flow.value.code.deviceAuthId === code.deviceAuthId
}

async function poll(code: CodexCode): Promise<void> {
  if (!showing(code)) return
  if (Date.now() >= code.expiresAt) {
    flow.value = { _tag: 'Failed', reason: 'The code expired before it was approved. Get a new one.' }
    return
  }
  const outcome = await settings.pollCodexCode(code)
  if (!showing(code)) return
  if (outcome._tag === 'Pending') schedule(code)
  else if (outcome._tag === 'SignedIn') flow.value = { _tag: 'Idle' }
  else flow.value = { _tag: 'Failed', reason: outcome.reason }
}

async function start(): Promise<void> {
  stop()
  flow.value = { _tag: 'Requesting' }
  const code = await settings.requestCodexCode()
  if ('error' in code) {
    flow.value = { _tag: 'Failed', reason: code.error }
    return
  }
  flow.value = { _tag: 'Waiting', code }
  schedule(code)
}

function cancel(): void {
  stop()
  flow.value = { _tag: 'Idle' }
}

onBeforeUnmount(stop)
</script>

<template>
  <div class="space-y-3">
    <div
      v-if="flow._tag === 'Waiting'"
      class="space-y-4 rounded-md border border-default p-4"
      role="group"
      aria-label="Codex sign in code"
    >
      <ol class="space-y-4 text-sm">
        <li class="space-y-2">
          <p class="text-muted">1. Open OpenAI's sign in page and sign in to your ChatGPT account.</p>
          <UButton
            :to="flow.code.verificationUrl"
            target="_blank"
            rel="noopener"
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-octicon-link-external-16"
            class="min-h-11"
            :label="flow.code.verificationUrl.replace('https://', '')"
          />
        </li>
        <li class="space-y-2">
          <p class="text-muted">2. Enter this code. It expires in 15 minutes.</p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="rounded-md bg-muted px-3 py-2 font-mono text-lg tracking-widest text-highlighted">{{
              flow.code.userCode
            }}</code>
            <UButton
              v-if="clipboardSupported"
              size="sm"
              color="neutral"
              variant="ghost"
              class="min-h-11"
              :icon="copied ? 'i-octicon-check-16' : 'i-octicon-copy-16'"
              :label="copied ? 'Copied' : 'Copy code'"
              @click="copy(flow.code.userCode)"
            />
          </div>
        </li>
      </ol>
      <p class="text-sm text-muted">
        Continue only if you started this sign in here. If someone else gave you this code, cancel.
      </p>
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-default pt-3">
        <p class="flex items-center gap-2 text-sm text-muted" role="status" aria-live="polite">
          <UIcon name="i-octicon-sync-16" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Waiting for you to approve the code…
        </p>
        <UButton size="sm" color="neutral" variant="ghost" class="min-h-11" label="Cancel" @click="cancel" />
      </div>
    </div>

    <template v-else>
      <UAlert
        v-if="flow._tag === 'Failed'"
        color="error"
        variant="subtle"
        title="Codex is not signed in."
        :description="flow.reason"
      />
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-simple-icons-openai"
        class="min-h-11"
        :label="props.configured ? 'Sign in again with ChatGPT' : 'Sign in with ChatGPT'"
        :loading="flow._tag === 'Requesting'"
        :disabled="flow._tag === 'Requesting' || settings.saving.value"
        @click="start"
      />
    </template>
  </div>
</template>
