<script setup lang="ts">
import SettingsConfiguration from './_SettingsConfiguration.vue'
import SettingsProviders from './_SettingsProviders.vue'
usePageTitle('Settings')
useHead({
  meta: [{ name: 'description', content: 'Service configuration, schedules, review policy and dashboard access.' }],
})
const settings = useSettings()
const { availability } = settings
onMounted(() => {
  void settings.load()
})
</script>
<template>
  <div class="mx-auto w-full max-w-5xl">
    <div v-if="availability._tag === 'Loading'" class="space-y-3" aria-busy="true" aria-label="Loading settings">
      <UiSkeleton class="h-32 w-full" /><UiSkeleton class="h-32 w-full" />
    </div>
    <UiEmptyState
      v-else-if="availability._tag === 'SignedOut'"
      icon="lock"
      title="Sign in to change settings"
      description="Sign in with the dashboard password, then reload this page."
      compact
    />
    <UAlert
      v-else-if="availability._tag === 'Failed'"
      color="error"
      variant="subtle"
      title="Settings could not be loaded."
      :description="availability.reason"
      :actions="[{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: () => settings.load() }]"
    />
    <SettingsConfiguration v-else>
      <template v-if="availability._tag === 'Available'" #providers><SettingsProviders part="providers" /></template>
      <template v-if="availability._tag === 'Available'" #github-account><SettingsProviders part="github" /></template>
    </SettingsConfiguration>
  </div>
</template>
