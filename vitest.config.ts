import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Minimal, calibrated test setup (risk R-01). Node environment is enough for the
// pure-logic units we test first (rate limiter, colour math). A jsdom/react setup
// can be layered in later when component tests earn their keep.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    globals: true,
  },
  resolve: {
    // Mirror tsconfig's "@/*" path alias so tests import the same way app code does.
    alias: { '@': resolve(__dirname, '.') },
  },
})
