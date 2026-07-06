import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChatStore } from '../../stores/chat';

describe('ChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('existing functionality', () => {
    it('adds user messages', () => {
      const store = useChatStore();
      store.addMessage({ role: 'user', content: 'Hello' });
      expect(store.messages).toHaveLength(1);
      expect(store.messages[0].role).toBe('user');
      expect(store.messages[0].content).toBe('Hello');
    });

    it('adds assistant messages', () => {
      const store = useChatStore();
      store.addMessage({ role: 'assistant', content: 'Hi there' });
      expect(store.messages[0].role).toBe('assistant');
    });

    it('clears messages', () => {
      const store = useChatStore();
      store.addMessage({ role: 'user', content: 'test' });
      store.clearMessages();
      expect(store.messages).toHaveLength(0);
    });
  });

  describe('tool message support', () => {
    it('addMessage with role "tool" stores toolName, toolArgs, toolResult', () => {
      const store = useChatStore();
      store.addMessage({
        role: 'tool',
        content: 'Read file src/auth.ts',
        toolName: 'read_file',
        toolArgs: { path: 'src/auth.ts' },
        toolResult: 'export class Auth {}',
      });

      const msg = store.messages[0];
      expect(msg.role).toBe('tool');
      expect(msg.toolName).toBe('read_file');
      expect(msg.toolArgs).toEqual({ path: 'src/auth.ts' });
      expect(msg.toolResult).toBe('export class Auth {}');
    });

    it('tool messages default to collapsed: true', () => {
      const store = useChatStore();
      store.addMessage({
        role: 'tool',
        content: 'Read file',
        toolName: 'read_file',
      });

      expect(store.messages[0].collapsed).toBe(true);
    });

    it('non-tool messages default to collapsed: false', () => {
      const store = useChatStore();
      store.addMessage({ role: 'user', content: 'Hi' });
      expect(store.messages[0].collapsed).toBe(false);
    });
  });

  describe('updateToolMessage', () => {
    it('updates an existing tool message by id', () => {
      const store = useChatStore();
      store.addMessage({
        role: 'tool',
        content: 'Reading...',
        toolName: 'read_file',
        toolStatus: 'running',
      });

      const id = store.messages[0].id;
      store.updateToolMessage(id, {
        toolResult: 'file contents',
        toolStatus: 'completed',
        content: 'Read file: src/auth.ts',
      });

      expect(store.messages[0].toolResult).toBe('file contents');
      expect(store.messages[0].toolStatus).toBe('completed');
      expect(store.messages[0].content).toBe('Read file: src/auth.ts');
    });

    it('does nothing if id not found', () => {
      const store = useChatStore();
      store.addMessage({ role: 'tool', content: 'test', toolName: 'read_file' });
      store.updateToolMessage('nonexistent', { toolResult: 'nope' });
      expect(store.messages[0].toolResult).toBeUndefined();
    });
  });

  describe('phase tracking', () => {
    it('message.phase field is stored and retrievable', () => {
      const store = useChatStore();
      store.addMessage({
        role: 'system',
        content: 'Planning...',
        phase: 'planning',
      });

      expect(store.messages[0].phase).toBe('planning');
    });
  });
});
