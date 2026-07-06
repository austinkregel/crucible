import { ref, type Ref } from 'vue';

export function useStreaming() {
  const streamingContent: Ref<string> = ref('');
  const isStreaming = ref(false);
  const currentRequestId: Ref<string | null> = ref(null);

  function startStream(requestId: string) {
    currentRequestId.value = requestId;
    streamingContent.value = '';
    isStreaming.value = true;
  }

  function appendToken(requestId: string, token: string) {
    if (requestId !== currentRequestId.value) return;
    streamingContent.value += token;
  }

  function endStream(requestId: string): string {
    if (requestId !== currentRequestId.value) return streamingContent.value;
    isStreaming.value = false;
    const content = streamingContent.value;
    streamingContent.value = '';
    currentRequestId.value = null;
    return content;
  }

  function cancelStream() {
    isStreaming.value = false;
    streamingContent.value = '';
    currentRequestId.value = null;
  }

  return {
    streamingContent,
    isStreaming,
    currentRequestId,
    startStream,
    appendToken,
    endStream,
    cancelStream,
  };
}
