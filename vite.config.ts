import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the built site works from any folder
  // (e.g. https://<user>.github.io/word-vec-game/).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
