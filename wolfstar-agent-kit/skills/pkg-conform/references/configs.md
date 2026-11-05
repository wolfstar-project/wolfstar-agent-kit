# Configuration Files

## .npmrc

Optional. Only needed for monorepos with hoisting issues:

```ini
shamefully-hoist=true
```

## .editorconfig

```ini
root = true

[*]
indent_size = 2
indent_style = space
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

## .gitignore

```gitignore
node_modules
dist
.output
.idea
.vscode
*.swp
.DS_Store
*.log
coverage
.env
.env.*
!.env.example
```

## .oxlintrc.json

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": { "correctness": "error" },
  "plugins": ["import", "oxc", "typescript", "vue"],
  "rules": {
    "eqeqeq": "error",
    "no-debugger": "error",
    "no-unused-vars": "error",
    "prefer-const": "error"
  },
  "ignorePatterns": ["docs/**"]
}
```

### eslint-plugin-harlanzw

Oxlint loads ESLint plugins as `jsPlugins` and reads the plugin from the default export.
`eslint-plugin-harlanzw` exports it by name, so re-export it:

```js
// .oxlint/harlanzw.mjs
import { plugin } from 'eslint-plugin-harlanzw'

export default plugin
```

Add `"jsPlugins": ["./.oxlint/harlanzw.mjs"]` to `.oxlintrc.json`, then enable rules as `harlanzw/<rule>`:

```json
{
  "jsPlugins": ["./.oxlint/harlanzw.mjs"],
  "rules": {
    "harlanzw/no-silent-catch": "error",
    "harlanzw/nuxt-await-navigate-to": "error",
    "harlanzw/nuxt-no-random": "error",
    "harlanzw/nuxt-no-unsafe-date": "error",
    "harlanzw/vue-no-reactive-destructuring": "error",
    "harlanzw/vue-no-reactivity-after-await": "error"
  }
}
```

Only rules that read a script run. Oxlint does not run Vue template rules (`link-*`, `vue-no-ref-access-in-templates`) or the Markdown rules (`ai-deslop-*`, `prompt-*`, `docs-*`).
Run a new rule across the repository as `warn` first. `no-test-file-reads`, `prefer-satisfies`, `vue-no-resolve-component-in-composables`, and `nuxt-prefer-navigate-to-over-router-push-replace` raise false positives on common patterns, so enable them only after a count.

## .oxfmtrc.json

```json
{
  "printWidth": 120,
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all"
}
```

## vitest.config.ts

Basic:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
})
```

With unit + e2e projects:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'test/e2e/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
        },
      },
    ],
  },
})
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "baseUrl": ".",
    "rootDir": ".",
    "types": ["node", "vitest/globals"],
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "strict": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## build.config.ts

```ts
import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      input: ['./src/index.ts'],
    },
  ],
})
```

With CLI and multiple entry points:

```ts
import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      input: ['./src/index.ts', './src/cli.ts', './src/types.ts'],
    },
  ],
})
```
