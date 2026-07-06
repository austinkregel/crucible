import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChatStore } from '../chat';

describe('ChatStore streaming', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('startStream', () => {
    it('sets isStreaming and creates assistant message', () => {
      const store = useChatStore();
      store.startStream('req-1');

      expect(store.isStreaming).toBe(true);
      expect(store.streamingContent).toBe('');
      expect(store.messages).toHaveLength(1);
      expect(store.messages[0].role).toBe('assistant');
      expect(store.messages[0].content).toBe('');
    });
  });

  describe('appendStreamToken', () => {
    it('appends to streamingContent and updates assistant message', () => {
      const store = useChatStore();
      store.startStream('req-1');
      store.appendStreamToken('req-1', 'Hello');
      store.appendStreamToken('req-1', ' World');

      expect(store.streamingContent).toBe('Hello World');
      expect(store.messages[0].content).toBe('Hello World');
    });

    it('ignores wrong requestId', () => {
      const store = useChatStore();
      store.startStream('req-1');
      store.appendStreamToken('wrong-id', 'Ignored');

      expect(store.streamingContent).toBe('');
      expect(store.messages[0].content).toBe('');
    });
  });

  describe('endStream', () => {
    it('resets streaming state', () => {
      const store = useChatStore();
      store.startStream('req-1');
      store.appendStreamToken('req-1', 'data');
      store.endStream('req-1');

      expect(store.isStreaming).toBe(false);
      expect(store.streamingContent).toBe('');
    });

    it('ignores wrong requestId', () => {
      const store = useChatStore();
      store.startStream('req-1');
      store.endStream('wrong-id');

      expect(store.isStreaming).toBe(true);
    });
  });

  describe('handleStreamError', () => {
    it('resets streaming state and adds error message', () => {
      const store = useChatStore();
      store.startStream('req-1');
      store.handleStreamError('req-1', 'Network failure');

      expect(store.isStreaming).toBe(false);
      expect(store.streamingContent).toBe('');
      expect(store.messages).toHaveLength(2);
      expect(store.messages[1].role).toBe('system');
      expect(store.messages[1].content).toContain('Network failure');
    });

    it('ignores wrong requestId', () => {
      const store = useChatStore();
      store.startStream('req-1');
      store.handleStreamError('wrong-id', 'Error');

      expect(store.isStreaming).toBe(true);
      expect(store.messages).toHaveLength(1);
    });
  });
});
