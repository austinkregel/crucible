import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag.startsWith('vscode-'),
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ext': path.resolve(__dirname, 'extension'),
      vscode: path.resolve(__dirname, 'extension/__mocks__/vscode.ts'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: [
      'extension/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.ts',
    ],
    environment: 'happy-dom',
    environmentMatchGlobs: [
      ['extension/**', 'node'],
    ],
  },
});
