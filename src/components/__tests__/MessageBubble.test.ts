import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MessageBubble from '../MessageBubble.vue';
import type { ChatMessage } from '../../stores/chat';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    collapsed: false,
    ...overrides,
  };
}

describe('MessageBubble', () => {
  it('renders user messages', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'user', content: 'Hello world' }) },
      global: {
        stubs: { MarkdownRenderer: true, ToolCallBlock: true },
      },
    });
    expect(wrapper.text()).toContain('You');
    expect(wrapper.text()).toContain('Hello world');
  });

  it('renders assistant messages', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'assistant', content: 'Hi there' }) },
      global: {
        stubs: { MarkdownRenderer: { template: '<div>{{ content }}</div>', props: ['content'] }, ToolCallBlock: true },
      },
    });
    expect(wrapper.text()).toContain('Assistant');
  });

  it('renders ToolCallBlock for messages with role "tool"', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: makeMessage({
          role: 'tool',
          content: 'read_file: src/auth.ts',
          toolName: 'read_file',
          toolArgs: { path: 'src/auth.ts' },
          toolResult: 'export class Auth {}',
          toolStatus: 'completed',
        }),
      },
      global: {
        stubs: {
          MarkdownRenderer: true,
          ToolCallBlock: { template: '<div data-testid="tool-block">ToolCallBlock stub</div>', props: ['toolName', 'args', 'result', 'status'] },
        },
      },
    });
    expect(wrapper.find('[data-testid="tool-block"]').exists()).toBe(true);
  });

  it('passes toolName, toolArgs, toolResult props to ToolCallBlock', () => {
    const ToolCallBlockStub = {
      template: '<div />',
      props: ['toolName', 'args', 'result', 'status', 'error', 'duration_ms'],
    };

    const wrapper = mount(MessageBubble, {
      props: {
        message: makeMessage({
          role: 'tool',
          content: 'Read file',
          toolName: 'read_file',
          toolArgs: { path: 'src/auth.ts' },
          toolResult: 'file content',
          toolStatus: 'completed',
        }),
      },
      global: {
        stubs: { MarkdownRenderer: true, ToolCallBlock: ToolCallBlockStub },
      },
    });

    const block = wrapper.findComponent(ToolCallBlockStub);
    expect(block.exists()).toBe(true);
    expect(block.props('toolName')).toBe('read_file');
    expect(block.props('args')).toEqual({ path: 'src/auth.ts' });
    expect(block.props('result')).toBe('file content');
  });

  it('existing system rendering unchanged', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'system', content: 'System message' }) },
      global: {
        stubs: { MarkdownRenderer: { template: '<div>{{ content }}</div>', props: ['content'] }, ToolCallBlock: true },
      },
    });
    expect(wrapper.text()).toContain('System');
  });

  it('renders context file badges when present', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: makeMessage({
          role: 'user',
          content: 'Check this',
          contextFiles: ['/path/to/file.ts', '/other/very-long-filename-that-should-be-truncated.vue'],
        }),
      },
      global: {
        stubs: { MarkdownRenderer: true, ToolCallBlock: true },
      },
    });
    expect(wrapper.text()).toContain('file.ts');
  });

  it('applies correct role color classes', () => {
    const userWrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'user' }) },
      global: { stubs: { MarkdownRenderer: true, ToolCallBlock: true } },
    });
    expect(userWrapper.html()).toContain('text-vscode-link');

    const assistantWrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'assistant' }) },
      global: { stubs: { MarkdownRenderer: true, ToolCallBlock: true } },
    });
    expect(assistantWrapper.html()).toContain('text-vscode-success');

    const systemWrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'system' }) },
      global: { stubs: { MarkdownRenderer: true, ToolCallBlock: true } },
    });
    expect(systemWrapper.html()).toContain('text-vscode-warning');
  });

  it('renders model badge when model is present', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'assistant', model: 'claude-sonnet' }) },
      global: { stubs: { MarkdownRenderer: true, ToolCallBlock: true } },
    });
    expect(wrapper.text()).toContain('claude-sonnet');
  });

  it('uses MarkdownRenderer for non-user messages', () => {
    const MdStub = { template: '<div class="md-stub">{{ content }}</div>', props: ['content'] };
    const wrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'assistant', content: '**bold**' }) },
      global: { stubs: { MarkdownRenderer: MdStub, ToolCallBlock: true } },
    });
    expect(wrapper.find('.md-stub').exists()).toBe(true);
  });

  it('uses plain text for user messages', () => {
    const wrapper = mount(MessageBubble, {
      props: { message: makeMessage({ role: 'user', content: 'plain text' }) },
      global: { stubs: { MarkdownRenderer: true, ToolCallBlock: true } },
    });
    expect(wrapper.find('p').text()).toBe('plain text');
  });

  it('handles tool message with failed status', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: makeMessage({
          role: 'tool',
          content: 'Error details',
          toolName: 'run_command',
          toolStatus: 'failed',
        }),
      },
      global: {
        stubs: {
          MarkdownRenderer: true,
          ToolCallBlock: { template: '<div class="tcb-stub" />', props: ['toolName', 'args', 'result', 'status', 'error', 'duration_ms'] },
        },
      },
    });
    const tcb = wrapper.find('.tcb-stub');
    expect(tcb.exists()).toBe(true);
  });
});
