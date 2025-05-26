import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Optional: to use Vitest globals like describe, it, expect without importing
    environment: 'node', // Specify Node.js environment for testing
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'],
    },
  },
});
