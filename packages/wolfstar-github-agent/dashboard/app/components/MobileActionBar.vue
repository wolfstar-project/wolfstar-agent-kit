<script setup lang="ts">
import { mobileBarPaths, pageTabs } from '../utils/navigation.ts'

/**
 * The phone's thumb-reach controls: the main pages, Pause or Resume, and More.
 * The desktop rail and header buttons stay where they were; this bar replaces
 * them below `md`, where the rail is hidden.
 */
const emit = defineEmits<{ keyboard: [] }>()
const { unhealthyRepositories } = defineProps<{ unhealthyRepositories: number }>()

const { snapshot, controlsUnavailable, controlPending, setAgentControl } = useDashboard()
const paused = computed(() => snapshot.value.agentControl._tag === 'Paused')
const tabs = mobileBarPaths.map((path) => pageTabs.find((tab) => tab.to === path)!)

const item =
  'relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 border-t-2 border-transparent px-1 text-xs text-muted hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-inverted disabled:opacity-50'
</script>

<template>
  <div
    class="flex shrink-0 items-stretch border-t border-default bg-muted pb-[env(safe-area-inset-bottom)] md:hidden"
    role="toolbar"
    aria-label="Quick actions"
  >
    <nav aria-label="Pages" class="flex min-w-0 flex-[4] items-stretch">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        :class="item"
        active-class=""
        exact-active-class="border-accented bg-accented text-highlighted"
      >
        <UIcon :name="tab.icon" class="size-5" aria-hidden="true" />
        <span class="max-w-full truncate">{{ tab.label }}</span>
        <span
          v-if="tab.to === '/watching' && unhealthyRepositories > 0"
          class="absolute right-[calc(50%-1.25rem)] top-2 size-1.5 rounded-full bg-error"
          role="img"
          aria-label="A repository needs attention"
        />
      </NuxtLink>
    </nav>
    <button
      type="button"
      :class="[item, 'border-s border-default']"
      :disabled="controlPending || controlsUnavailable"
      :aria-label="paused ? 'Resume the agent' : 'Pause the agent'"
      @click="setAgentControl(paused ? 'resume' : 'pause')"
    >
      <UIcon
        :name="controlPending ? 'i-octicon-sync-16' : paused ? 'i-octicon-play-16' : 'i-octicon-stop-16'"
        class="size-5"
        :class="{ 'animate-spin': controlPending, 'text-warning': paused }"
        aria-hidden="true"
      />
      <span>{{ paused ? 'Resume' : 'Pause' }}</span>
    </button>
    <OverflowMenu side="top" @keyboard="emit('keyboard')">
      <button type="button" :class="item" aria-label="More">
        <UIcon name="i-octicon-kebab-horizontal-16" class="size-5" aria-hidden="true" />
        <span>More</span>
      </button>
    </OverflowMenu>
  </div>
</template>
