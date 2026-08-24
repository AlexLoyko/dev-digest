import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// vitest does NOT read tsconfig `paths` — this resolve.alias must mirror
// tsconfig.json's `paths` exactly, or any test importing `@devdigest/shared`
// (or `@devdigest/reviewer-core/*`) will fail to resolve at test time even
// though `tsc` and `tsx` resolve it fine.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
  resolve: {
    // Order matters: the trailing-slash (directory-prefix) entries must come
    // BEFORE the bare "@devdigest/shared" entry. Vite's alias matcher treats a
    // bare, non-slash-terminated `find` as matching both the exact specifier
    // AND any deeper path segment (e.g. "@devdigest/shared/contracts/agent"),
    // so if it were listed first it would swallow multi-segment imports and
    // redirect them through the `index.ts` file path, breaking resolution.
    alias: [
      {
        find: '@devdigest/shared/',
        replacement: `${fileURLToPath(
          new URL('../server/src/vendor/shared/', import.meta.url),
        )}/`,
      },
      {
        find: '@devdigest/reviewer-core/',
        replacement: `${fileURLToPath(new URL('../reviewer-core/src/', import.meta.url))}/`,
      },
      {
        find: '@devdigest/shared',
        replacement: fileURLToPath(
          new URL('../server/src/vendor/shared/index.ts', import.meta.url),
        ),
      },
    ],
  },
});
