import * as vscode from 'vscode';

// Minimal v0 skeleton. The chatSkills contribution in package.json is what
// makes the noggin skill available to Copilot Chat. This extension entry point
// is a placeholder for future UI (status bar, tree view, language model tools,
// commands).

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('noggin.show', async () => {
      vscode.window.showInformationMessage('Noggin: show — not yet implemented.');
    }),
    vscode.commands.registerCommand('noggin.push', async () => {
      vscode.window.showInformationMessage('Noggin: push — not yet implemented.');
    }),
    vscode.commands.registerCommand('noggin.add', async () => {
      vscode.window.showInformationMessage('Noggin: add — not yet implemented.');
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up yet
}
