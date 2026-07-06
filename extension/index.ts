import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { CrucibleViewProvider } from './webviewProvider';

const CRUCIBLE_DIR = path.join(os.homedir(), '.crucible');

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Crucible');
  output.appendLine('[Crucible] Extension activating...');
  context.subscriptions.push(output);

  ensureCacheDirectory();

  const provider = new CrucibleViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('crucible.chatView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('crucible.focusChat', () => {
      vscode.commands.executeCommand('crucible.chatView.focus');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('crucible.newSession', () => {
      provider.postMessage({ type: 'newSession' });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('crucible.clearCache', async () => {
      const wsHash = getWorkspaceHash();
      const cacheDir = path.join(CRUCIBLE_DIR, wsHash);
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      vscode.window.showInformationMessage('Crucible: Cache cleared.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('crucible.setApiKey', async () => {
      const providerChoice = await vscode.window.showQuickPick(
        ['OpenAI', 'Anthropic'],
        { placeHolder: 'Select provider to configure API key' },
      );
      if (!providerChoice) return;

      const key = await vscode.window.showInputBox({
        prompt: `Enter your ${providerChoice} API key`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;

      const secretKey = `crucible.${providerChoice.toLowerCase()}ApiKey`;
      await context.secrets.store(secretKey, key);
      vscode.window.showInformationMessage(`Crucible: ${providerChoice} API key saved.`);
      provider.postMessage({ type: 'apiKeyChanged', provider: providerChoice.toLowerCase() });
    }),
  );
}

export function deactivate() {}

function ensureCacheDirectory() {
  fs.mkdirSync(CRUCIBLE_DIR, { recursive: true });
  const wsHash = getWorkspaceHash();
  const workspaceCache = path.join(CRUCIBLE_DIR, wsHash);
  fs.mkdirSync(workspaceCache, { recursive: true });
}

function getWorkspaceHash(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return 'no-workspace';
  const uri = folders[0].uri.fsPath;
  let hash = 0;
  for (let i = 0; i < uri.length; i++) {
    const chr = uri.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
