import * as vscode from 'vscode';
import { getWebviewHtml } from 'virtual:vscode';
import { handleWebviewMessage } from './messageHandler';

export class CrucibleViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = getWebviewHtml({
      serverUrl: process.env.VITE_DEV_SERVER_URL,
      webview: webviewView.webview,
      context: this.context,
    });

    webviewView.webview.onDidReceiveMessage(
      (message) => handleWebviewMessage(message, this.context, webviewView),
      undefined,
      this.context.subscriptions,
    );
  }

  postMessage(message: unknown) {
    this.view?.webview.postMessage(message);
  }
}
