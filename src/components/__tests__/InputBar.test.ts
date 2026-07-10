import { vi, describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('../../composables/useVSCode', () => ({
  useVSCode: () => ({
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  }),
}));

import InputBar from '../InputBar.vue';

describe('InputBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function mountBar(propsOverrides = {}) {
    return mount(InputBar, {
      props: {
        contextFiles: [],
        currentModels: ['model-a', 'model-b'],
        ...propsOverrides,
      },
      global: {
        stubs: {
          PopoverSelect: {
            template: '<div class="popover-stub" @click="$emit(\'update:modelValue\', \'agent\')"><slot />{{ modelValue }}</div>',
            props: ['options', 'modelValue', 'pillClass', 'placeholder'],
            emits: ['update:modelValue'],
          },
        },
      },
    });
  }

  it('renders textarea', () => {
    const wrapper = mountBar();
    expect(wrapper.find('textarea').exists()).toBe(true);
  });

  it('emits send on Enter key', async () => {
    const wrapper = mountBar();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('Hello');
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: false });
    expect(wrapper.emitted('send')).toBeTruthy();
    expect(wrapper.emitted('send')![0]).toEqual(['Hello']);
  });

  it('does not emit send on Shift+Enter', async () => {
    const wrapper = mountBar();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('Hello');
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('does not emit send when input is empty', async () => {
    const wrapper = mountBar();
    const textarea = wrapper.find('textarea');
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: false });
    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('shows file badges when contextFiles provided', () => {
    const wrapper = mountBar({ contextFiles: ['/path/to/file.ts', '/path/to/other.vue'] });
    expect(wrapper.text()).toContain('file.ts');
    expect(wrapper.text()).toContain('other.vue');
  });

  it('emits removeFile when badge X clicked', async () => {
    const wrapper = mountBar({ contextFiles: ['/path/to/file.ts'] });
    const removeBtn = wrapper.find('button');
    await removeBtn.trigger('click');
    expect(wrapper.emitted('removeFile')).toBeTruthy();
  });

  it('disables textarea when disabled prop is true', () => {
    const wrapper = mountBar({ disabled: true });
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('clears input after submit', async () => {
    const wrapper = mountBar();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('Message');
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: false });
    expect((textarea.element as HTMLTextAreaElement).value).toBe('');
  });

  it('shows mode hints for plan and agent modes', async () => {
    const { useChatStore } = await import('../../stores/chat');
    const store = useChatStore();

    store.setMode('plan');
    const wrapper = mountBar();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Multi-agent planning');

    store.setMode('agent');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Full agent pipeline');
  });

  it('handles dragenter/dragleave transitions', async () => {
    const wrapper = mountBar();
    const container = wrapper.find('div');

    await container.trigger('dragenter', { dataTransfer: { dropEffect: '' } });
    expect(wrapper.html()).toContain('border-vscode-link');

    await container.trigger('dragleave');
    expect(wrapper.html()).not.toContain('border-vscode-link');
  });

  it('emits filesAdded on drop with text/uri-list', async () => {
    const wrapper = mountBar();
    const container = wrapper.find('div');

    await container.trigger('drop', {
      dataTransfer: {
        getData: (type: string) => {
          if (type === 'text/uri-list') return 'file:///path/to/file.ts\n';
          return '';
        },
        files: [],
      },
    });

    expect(wrapper.emitted('filesAdded')).toBeTruthy();
  });

  it('emits filesAdded on drop with text/plain paths', async () => {
    const wrapper = mountBar();
    const container = wrapper.find('div');

    await container.trigger('drop', {
      dataTransfer: {
        getData: (type: string) => {
          if (type === 'text/plain') return '/src/file.ts\n';
          return '';
        },
        files: [],
      },
    });

    expect(wrapper.emitted('filesAdded')).toBeTruthy();
  });

  it('auto-resizes textarea on input', async () => {
    const wrapper = mountBar();
    const textarea = wrapper.find('textarea');
    await textarea.trigger('input');
  });
});
