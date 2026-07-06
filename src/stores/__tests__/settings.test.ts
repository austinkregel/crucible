import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from '../settings';

describe('SettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('has empty providers by default', () => {
    const store = useSettingsStore();
    expect(store.providers).toEqual([]);
  });

  it('has idle indexStatus by default', () => {
    const store = useSettingsStore();
    expect(store.indexStatus.state).toBe('idle');
    expect(store.indexStatus.totalFiles).toBe(0);
  });

  it('setProviders replaces providers list', () => {
    const store = useSettingsStore();
    store.setProviders([
      { id: 'ollama', name: 'Ollama', models: ['qwen3:27b'], connected: true },
      { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-5-20250514'] },
    ]);
    expect(store.providers).toHaveLength(2);
    expect(store.providers[0].id).toBe('ollama');
  });

  it('setConfig updates roles', () => {
    const store = useSettingsStore();
    store.setConfig({
      roles: {
        planner: { provider: 'openai', model: 'gpt-4o' },
      },
      adversarial: store.adversarial,
    });
    expect(store.roles.planner.provider).toBe('openai');
    expect(store.roles.planner.model).toBe('gpt-4o');
  });

  it('setConfig updates adversarial settings', () => {
    const store = useSettingsStore();
    store.setConfig({
      roles: store.roles,
      adversarial: {
        confidenceThreshold: 0.9,
        maxIterations: 5,
        postValidation: false,
      },
    });
    expect(store.adversarial.confidenceThreshold).toBe(0.9);
    expect(store.adversarial.maxIterations).toBe(5);
    expect(store.adversarial.postValidation).toBe(false);
  });

  it('setIndexStatus replaces index status', () => {
    const store = useSettingsStore();
    store.setIndexStatus({
      state: 'indexing',
      totalFiles: 100,
      processedFiles: 50,
      totalChunks: 200,
    });
    expect(store.indexStatus.state).toBe('indexing');
    expect(store.indexStatus.totalFiles).toBe(100);
    expect(store.indexStatus.processedFiles).toBe(50);
  });
});
