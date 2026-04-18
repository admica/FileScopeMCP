import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/broker/**',
        'src/cascade/**',
        'src/change-detector/**',
        'src/db/**',
        'src/coordinator.ts',
        'src/file-watcher.ts',
        'src/config-utils.ts',
        'src/mcp-server.ts',
      ],
      exclude: [
        'src/nexus/**',
        'src/types.ts',
        'src/**/*.test.ts',
        'tests/**',
      ],
    },
  },
});
