<script setup lang="ts">
const auth = useBrowserAuth()
const label = ref('')
const browserSupported = computed(() => import.meta.client && !!window.PublicKeyCredential)
onMounted(() => {
  void auth.manage()
})
onBeforeUnmount(() => {
  auth.managing.value = false
})
</script>
<template>
  <section aria-labelledby="passkeys-title" class="space-y-5">
    <h2 id="passkeys-title" tabindex="-1" class="text-base font-medium text-highlighted focus:outline-none">
      Passkeys
    </h2>

    <div class="space-y-5" :aria-busy="auth.pending.value !== null">
      <p v-if="auth.pending.value === 'list'" role="status" class="text-sm text-muted">Loading Passkeys.</p>
      <ul v-else-if="auth.credentials.value.length" class="divide-y divide-default">
        <li
          v-for="credential in auth.credentials.value"
          :key="credential.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <span class="min-w-0 break-words text-sm text-highlighted">{{ credential.label }}</span>
          <UButton
            label="Remove"
            :aria-label="`Remove Passkey: ${credential.label}`"
            color="error"
            variant="ghost"
            class="min-h-11 shrink-0"
            :disabled="
              auth.pending.value !== null ||
              (auth.session.value?.bootstrapKind === 'passkey' && auth.credentials.value.length <= 1)
            "
            @click="auth.remove(credential.id)"
          />
        </li>
      </ul>
      <p v-else class="text-sm text-muted">No Passkeys added.</p>
      <form class="space-y-3 border-t border-default pt-4" @submit.prevent="auth.add(label)">
        <label for="passkey-label" class="block text-sm font-medium text-highlighted">Passkey name</label>
        <UInput
          id="passkey-label"
          v-model="label"
          maxlength="80"
          autocomplete="off"
          class="w-full"
          :ui="{ base: 'min-h-11' }"
          :disabled="auth.pending.value !== null"
        />
        <UButton
          type="submit"
          label="Add Passkey"
          icon="i-octicon-key-16"
          class="min-h-11"
          :loading="auth.pending.value === 'add'"
          :disabled="auth.pending.value !== null || !browserSupported"
        />
        <p v-if="!browserSupported" class="text-sm text-muted">This browser does not support Passkeys.</p>
      </form>
      <PasskeyProgress />
      <p v-if="auth.session.value?.bootstrapKind === 'passkey'" class="text-sm text-muted">
        Add another Passkey before removing the last Passkey.
      </p>
      <p v-else class="text-sm text-muted">Use the password or pairing link if you lose a Passkey.</p>
      <div v-if="auth.error.value" class="space-y-3">
        <p role="alert" class="text-sm text-error">{{ auth.error.value }}</p>
        <UButton
          label="Reload Passkeys"
          color="neutral"
          variant="outline"
          class="min-h-11"
          :disabled="auth.pending.value !== null"
          @click="auth.manage"
        />
      </div>
    </div>
  </section>
</template>
