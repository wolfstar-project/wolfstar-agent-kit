<script setup lang="ts">
import SettingsConfiguration from './_SettingsConfiguration.vue'
usePageTitle('Settings')
useHead({
  meta: [{ name: 'description', content: 'Service configuration, schedules, review policy and dashboard access.' }],
})
</script>
<template>
  <div class="mx-auto w-full max-w-5xl">
    <SettingsConfiguration />
  </div>
</template>
