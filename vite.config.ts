import { defineConfig } from 'vite';
import vscode from '@tomjs/vite-plugin-vscode';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag.startsWith('vscode-'),
        },
      },
    }),
    vscode({
      extension: {
        entry: 'extension/index.ts',
        external: [
          '@lancedb/lancedb',
          'code-chunk',
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
      '@ext': '/extension',
    },
  },
});
