import { ref, onMounted, onUnmounted } from 'vue';

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

let vscodeApi: VSCodeApi | undefined;

function getVSCodeApi(): VSCodeApi {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi!;
}

export function useVSCode() {
  const api = getVSCodeApi();

  function postMessage(message: unknown) {
    api.postMessage(message);
  }

  function onMessage(handler: (message: any) => void) {
    const listener = (event: MessageEvent) => {
      handler(event.data);
    };
    onMounted(() => window.addEventListener('message', listener));
    onUnmounted(() => window.removeEventListener('message', listener));
  }

  function getState<T>(): T | undefined {
    return api.getState() as T | undefined;
  }

  function setState<T>(state: T) {
    api.setState(state);
  }

  return { postMessage, onMessage, getState, setState };
}
