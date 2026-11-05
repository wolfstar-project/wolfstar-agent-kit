export interface PageTab {
  label: string
  to: string
  icon: string
}

export const pageTabs: PageTab[] = [
  { label: 'Sessions', to: '/sessions', icon: 'i-octicon-terminal-16' },
  { label: 'Board', to: '/', icon: 'i-octicon-columns-16' },
  { label: 'History', to: '/history', icon: 'i-octicon-history-16' },
  { label: 'Watching', to: '/watching', icon: 'i-octicon-broadcast-16' },
  { label: 'Routines', to: '/routines', icon: 'i-octicon-calendar-16' },
  { label: 'Stats', to: '/stats', icon: 'i-octicon-graph-16' },
]

export const settingsTab: PageTab = { label: 'Settings', to: '/settings', icon: 'i-octicon-gear-16' }

/** The pages the bottom bar keeps one tap away on a phone. The rest wait in More. */
export const mobileBarPaths = ['/', '/sessions', '/watching', '/routines']
