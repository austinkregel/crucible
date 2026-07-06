import { vi } from 'vitest';

const _configStore: Record<string, any> = {
  'terminal.allowedCommands': ['npm', 'npx', 'git', 'ls', 'node'],
  'terminal.blockedCommands': ['rm -rf /', 'sudo'],
  'terminal.requireApproval': false,
  'adversarial.confidenceThreshold': 0.7,
  'adversarial.maxIterations': 3,
  'adversarial.postValidation': true,
  'indexing.enabled': true,
  'providers.ollama.baseUrl': 'http://localhost:11434',
};

const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: vi.fn(<T>(key: string, defaultValue?: T): T => {
      const val = _configStore[key];
      return val !== undefined ? val : (defaultValue as T);
    }),
    update: vi.fn(),
    has: vi.fn(() => true),
    inspect: vi.fn(),
  })),
  workspaceFolders: [
    {
      uri: {
        fsPath: '/test-workspace',
        scheme: 'file',
        path: '/test-workspace',
      },
      name: 'test-workspace',
      index: 0,
    },
  ],
  findFiles: vi.fn().mockResolvedValue([]),
  openTextDocument: vi.fn().mockResolvedValue({
    getText: vi.fn(() => ''),
    uri: { fsPath: '/test-workspace/file.ts' },
  }),
  fs: {
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ type: 1, size: 100 }),
  },
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  })),
  onDidChangeTextDocument: vi.fn(),
  onDidDeleteFiles: vi.fn(),
};

const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn().mockResolvedValue('Allow'),
  showErrorMessage: vi.fn(),
  createTerminal: vi.fn(() => ({
    sendText: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  activeTextEditor: undefined as any,
  showTextDocument: vi.fn(),
};

const Uri = {
  file: vi.fn((p: string) => ({
    fsPath: p,
    scheme: 'file',
    path: p,
  })),
  joinPath: vi.fn((base: any, ...parts: string[]) => {
    const joined = [base.fsPath, ...parts].join('/');
    return { fsPath: joined, scheme: 'file', path: joined };
  }),
  parse: vi.fn((s: string) => ({ fsPath: s, scheme: 'file', path: s })),
};

const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

const EventEmitter = vi.fn().mockImplementation(() => ({
  event: vi.fn(),
  fire: vi.fn(),
  dispose: vi.fn(),
}));

const Disposable = {
  from: vi.fn((...disposables: any[]) => ({
    dispose: vi.fn(() => disposables.forEach((d: any) => d.dispose?.())),
  })),
};

export {
  workspace,
  window,
  Uri,
  commands,
  EventEmitter,
  Disposable,
  _configStore,
};

export default {
  workspace,
  window,
  Uri,
  commands,
  EventEmitter,
  Disposable,
};
