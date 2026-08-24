import * as vscode from 'vscode';
import type { HumanChannel, AgentQuestion, AgentAnswer, ApprovalDecision } from '../contracts/broker';

/**
 * A HumanChannel backed by native VSCode modals — the transitional default used by the
 * single top-level agent until the webview-routed broker (#3) is wired in at integration.
 *
 * It deliberately mirrors the pre-refactor approval UX (Allow / Allow & Remember / Deny) so
 * behavior is unchanged for the top-level agent. Concurrent sub-agents must NOT use this —
 * they get a broker-backed HumanChannel so their questions queue and stay attributed.
 */
export function nativeHumanChannel(): HumanChannel {
  return {
    async approve(req: Omit<AgentQuestion, 'kind'>): Promise<ApprovalDecision> {
      const choice = await vscode.window.showWarningMessage(
        req.prompt,
        { modal: true },
        'Allow',
        'Allow & Remember',
        'Deny',
      );
      if (choice === 'Allow') return { allowed: true, remember: false };
      if (choice === 'Allow & Remember') return { allowed: true, remember: true };
      return { allowed: false, remember: false };
    },

    async ask(req: AgentQuestion): Promise<AgentAnswer> {
      if (req.kind === 'text') {
        const text = await vscode.window.showInputBox({ prompt: req.prompt });
        return text === undefined ? { cancelled: true } : { text };
      }
      const options = req.options ?? [];
      const choice = await vscode.window.showQuickPick(options, { placeHolder: req.prompt });
      return choice === undefined ? { cancelled: true } : { choice };
    },
  };
}
