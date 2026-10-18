<script setup lang="ts">
defineOptions({ inheritAttrs: false })
const auth = useBrowserAuth()
const open = ref(false)
const error = ref('')
function confirmSignOut() {
  error.value = ''
  open.value = true
}
async function signOut() {
  error.value = ''
  await auth.logout()
  error.value = auth.error.value
  if (!auth.error.value) open.value = false
}
</script>
<template>
  <div v-bind="$attrs">
    <UButton
      aria-label="Sign out"
      title="Sign out"
      icon="i-octicon-sign-out-16"
      color="neutral"
      variant="ghost"
      class="w-full min-h-11 min-w-11 justify-center rounded-none"
      :disabled="auth.pending.value !== null"
      @click="confirmSignOut"
    />
  </div>
  <ConfirmModal
    v-model:open="open"
    title="Sign out?"
    consequence="End your dashboard session on this browser?"
    confirm-label="Yes, sign out"
    :pending="auth.pending.value === 'logout'"
    :error="error || null"
    @confirm="signOut"
  />
</template>
