<script setup lang="ts">
import SettingsPasskeys from './_SettingsPasskeys.vue'

const passkeysOpen = ref(false)
async function openPasskeys() {
  passkeysOpen.value = true
  await nextTick()
  document.getElementById('passkeys-title')?.focus()
}
async function backToAccount() {
  passkeysOpen.value = false
  await nextTick()
  document.getElementById('settings-passkeys-entry')?.focus()
}
</script>

<template>
  <div class="space-y-5">
    <template v-if="passkeysOpen">
      <UButton
        label="Back to account"
        icon="i-octicon-arrow-left-16"
        color="neutral"
        variant="ghost"
        class="min-h-11"
        @click="backToAccount"
      />
      <SettingsPasskeys />
    </template>
    <UButton
      v-else
      id="settings-passkeys-entry"
      color="neutral"
      variant="outline"
      class="min-h-16 w-full justify-between gap-4 p-4 text-start"
      aria-label="Manage Passkeys"
      @click="openPasskeys"
    >
      <span class="min-w-0 space-y-1 whitespace-normal">
        <span class="block text-sm font-medium text-highlighted">Passkeys</span>
        <span class="block text-sm font-normal text-muted">Manage sign-in credentials for this dashboard address.</span>
      </span>
      <UIcon name="i-octicon-chevron-right-16" class="size-4 shrink-0 text-muted" aria-hidden="true" />
    </UButton>
  </div>
</template>
