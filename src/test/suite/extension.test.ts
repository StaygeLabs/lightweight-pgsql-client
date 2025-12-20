import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    const extension = vscode.extensions.getExtension('steve.lightweight-pgsql-client');
    assert.ok(extension, 'Extension should be installed');
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('steve.lightweight-pgsql-client');
    if (extension) {
      await extension.activate();
      assert.ok(extension.isActive, 'Extension should be active');
    }
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);

    const expectedCommands = [
      'pgsql.connect',
      'pgsql.disconnect',
      'pgsql.executeQuery',
      'pgsql.newQuery',
      'pgsql.refreshConnections',
      'pgsql.clearHistory',
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    }
  });

  test('New Query command should open SQL document', async () => {
    await vscode.commands.executeCommand('pgsql.newQuery');

    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, 'Editor should be open');
    assert.strictEqual(editor?.document.languageId, 'sql', 'Document should be SQL');
  });
});
