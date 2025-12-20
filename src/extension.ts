import * as vscode from 'vscode';
import { ConnectionManager } from './services/connectionManager';
import { QueryExecutor } from './services/queryExecutor';
import { SchemaService } from './services/schemaService';
import { DataModificationService } from './services/dataModificationService';
import { ConnectionTreeProvider } from './providers/connectionTreeProvider';
import { QueryHistoryProvider } from './providers/queryHistoryProvider';
import { SqlCompletionProvider } from './providers/completionProvider';
import { SqlHoverProvider } from './providers/hoverProvider';
import { SqlFormattingProvider, SqlRangeFormattingProvider } from './providers/formatProvider';
import { ResultsViewProvider } from './views/resultsPanel';
import { TableInfoPanel } from './views/tableInfoPanel';
import { connectCommand, executeQueryCommand } from './commands';
import { ConnectionTreeItem } from './providers/connectionTreeProvider';
import { QueryHistoryItem } from './models/types';
import { initSecretStorage } from './services/secretStorage';
import { DocumentConnectionTracker } from './services/documentConnectionTracker';

const SQL_SELECTOR: vscode.DocumentSelector = [
  { language: 'sql' },
  { language: 'pgsql' },
  { scheme: 'untitled', language: 'sql' },
];

export function activate(context: vscode.ExtensionContext) {
  console.log('PostgreSQL Client is now active');

  // Initialize secret storage for secure password management
  initSecretStorage(context);

  // Initialize services
  const connectionManager = new ConnectionManager();
  const queryExecutor = new QueryExecutor(connectionManager);
  const schemaService = new SchemaService(connectionManager);
  const dataModificationService = new DataModificationService(connectionManager);
  const resultsViewProvider = new ResultsViewProvider(context.extensionUri);
  resultsViewProvider.setDataModificationService(dataModificationService);
  resultsViewProvider.setQueryExecutor(queryExecutor);
  const documentConnectionTracker = new DocumentConnectionTracker(connectionManager);

  // Register results view in bottom panel
  const resultsViewDisposable = vscode.window.registerWebviewViewProvider(
    ResultsViewProvider.viewType,
    resultsViewProvider
  );

  // Initialize providers
  const connectionTreeProvider = new ConnectionTreeProvider(connectionManager, schemaService);
  const queryHistoryProvider = new QueryHistoryProvider(queryExecutor);
  const completionProvider = new SqlCompletionProvider(connectionManager, schemaService);
  const hoverProvider = new SqlHoverProvider(connectionManager, schemaService);
  const formatProvider = new SqlFormattingProvider();
  const rangeFormatProvider = new SqlRangeFormattingProvider();

  // Register language features
  const completionDisposable = vscode.languages.registerCompletionItemProvider(
    SQL_SELECTOR,
    completionProvider,
    '.', ' '
  );

  const hoverDisposable = vscode.languages.registerHoverProvider(
    SQL_SELECTOR,
    hoverProvider
  );

  const formatDisposable = vscode.languages.registerDocumentFormattingEditProvider(
    SQL_SELECTOR,
    formatProvider
  );

  const rangeFormatDisposable = vscode.languages.registerDocumentRangeFormattingEditProvider(
    SQL_SELECTOR,
    rangeFormatProvider
  );

  // Register tree views
  const connectionsView = vscode.window.createTreeView('pgsql.connections', {
    treeDataProvider: connectionTreeProvider,
    showCollapseAll: true,
  });

  const historyView = vscode.window.createTreeView('pgsql.queryHistory', {
    treeDataProvider: queryHistoryProvider,
  });

  // Register commands
  const commands = [
    vscode.commands.registerCommand('pgsql.connect', () =>
      connectCommand(connectionManager, context.extensionUri)
    ),

    vscode.commands.registerCommand('pgsql.disconnect', async () => {
      // Disconnect all connections
      const connections = connectionManager.getAllConnections();
      if (connections.length > 0) {
        await connectionManager.disconnectAll();
        vscode.window.showInformationMessage('All connections disconnected');
      }
    }),

    // Connect a specific connection from tree view
    vscode.commands.registerCommand('pgsql.connectItem', async (item: ConnectionTreeItem) => {
      if (!item?.data?.connectionId) {
        return;
      }
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Connecting...',
            cancellable: false,
          },
          async () => {
            await connectionManager.connectById(item.data!.connectionId!);
          }
        );
        vscode.window.showInformationMessage(`Connected to ${item.label}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== 'Password required') {
          vscode.window.showErrorMessage(`Failed to connect: ${message}`);
        }
      }
    }),

    // Disconnect a specific connection from tree view
    vscode.commands.registerCommand('pgsql.disconnectItem', async (item: ConnectionTreeItem) => {
      if (!item?.data?.connectionId) {
        return;
      }
      await connectionManager.disconnect(item.data.connectionId);
      vscode.window.showInformationMessage(`Disconnected from ${item.label}`);
    }),

    // Delete a connection config
    vscode.commands.registerCommand('pgsql.deleteConnection', async (item: ConnectionTreeItem) => {
      if (!item?.data?.connectionId) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete connection "${item.label}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm === 'Delete') {
        await connectionManager.deleteConnectionConfig(item.data.connectionId);
        vscode.window.showInformationMessage(`Connection "${item.label}" deleted`);
      }
    }),

    // Edit a connection
    vscode.commands.registerCommand('pgsql.editConnection', async (item: ConnectionTreeItem) => {
      if (!item?.data?.connectionId) {
        return;
      }

      const configs = connectionManager.getSavedConnectionConfigs();
      const existingConfig = configs.find((c) => c.id === item.data!.connectionId);
      if (!existingConfig) {
        return;
      }

      // Get existing password from secret storage
      const secretStorage = await import('./services/secretStorage').then((m) => m.getSecretStorage());
      const existingPassword = await secretStorage.getPassword(existingConfig.id);

      // Show form with existing config
      const { ConnectionFormPanel } = await import('./views/connectionForm');
      const updatedConfig = await ConnectionFormPanel.show(context.extensionUri, {
        ...existingConfig,
        password: existingPassword || '',
      });

      if (updatedConfig) {
        // Was connected before editing?
        const wasConnected = connectionManager.isConnected(existingConfig.id);

        // Disconnect if connected
        if (wasConnected) {
          await connectionManager.disconnect(existingConfig.id);
        }

        // Save updated config
        if (updatedConfig.password) {
          await secretStorage.storePassword(updatedConfig.id, updatedConfig.password);
        }
        await connectionManager.saveConnectionConfig(updatedConfig);

        // Reconnect if was connected
        if (wasConnected) {
          try {
            await connectionManager.connect(updatedConfig);
            vscode.window.showInformationMessage(`Connection "${updatedConfig.name}" updated and reconnected`);
          } catch {
            vscode.window.showInformationMessage(`Connection "${updatedConfig.name}" updated`);
          }
        } else {
          vscode.window.showInformationMessage(`Connection "${updatedConfig.name}" updated`);
        }
      }
    }),

    vscode.commands.registerCommand('pgsql.executeQuery', () =>
      executeQueryCommand(queryExecutor, resultsViewProvider, documentConnectionTracker)
    ),

    vscode.commands.registerCommand('pgsql.switchDocumentConnection', () =>
      documentConnectionTracker.switchDocumentConnection()
    ),

    vscode.commands.registerCommand('pgsql.newQuery', async () => {
      const doc = await vscode.workspace.openTextDocument({
        language: 'sql',
        content: '-- New Query\n\n',
      });
      const editor = await vscode.window.showTextDocument(doc);
      // Move cursor to the end
      const lastLine = doc.lineCount - 1;
      const lastChar = doc.lineAt(lastLine).text.length;
      editor.selection = new vscode.Selection(lastLine, lastChar, lastLine, lastChar);
    }),

    vscode.commands.registerCommand('pgsql.refreshConnections', () => {
      connectionTreeProvider.refresh();
    }),

    vscode.commands.registerCommand('pgsql.openHistoryQuery', async (item: QueryHistoryItem) => {
      const connection = item.connectionId
        ? connectionManager.getConnection(item.connectionId)
        : undefined;
      const connectionInfo = connection
        ? `-- Connection: ${connection.config.name} (${connection.config.database})\n`
        : '';
      const doc = await vscode.workspace.openTextDocument({
        language: 'sql',
        content: `${connectionInfo}${item.sql}\n`,
      });
      await vscode.window.showTextDocument(doc);
      if (item.connectionId && connectionManager.isConnected(item.connectionId)) {
        documentConnectionTracker.associateDocumentWithConnection(doc, item.connectionId);
      }
    }),

    vscode.commands.registerCommand('pgsql.clearHistory', () => {
      queryExecutor.clearHistory();
      queryHistoryProvider.refresh();
      vscode.window.showInformationMessage('Query history cleared');
    }),

    vscode.commands.registerCommand('pgsql.viewTableInfo', async (item: ConnectionTreeItem) => {
      if (!item?.data?.schema || !item?.data?.table) {
        vscode.window.showWarningMessage('Please select a table first');
        return;
      }
      await TableInfoPanel.show(
        context.extensionUri,
        schemaService,
        item.data.schema,
        item.data.table,
        item.data.connectionId
      );
    }),

    vscode.commands.registerCommand('pgsql.copyTableName', async (item: ConnectionTreeItem) => {
      if (!item?.data?.schema || !item?.data?.table) {
        return;
      }
      const fullName = `"${item.data.schema}"."${item.data.table}"`;
      await vscode.env.clipboard.writeText(fullName);
      vscode.window.showInformationMessage(`Copied: ${fullName}`);
    }),

    vscode.commands.registerCommand('pgsql.selectTop100', async (item: ConnectionTreeItem) => {
      if (!item?.data?.schema || !item?.data?.table || !item?.data?.connectionId) {
        return;
      }
      const connection = connectionManager.getConnection(item.data.connectionId);
      const connectionInfo = connection
        ? `-- Connection: ${connection.config.name} (${connection.config.database})\n`
        : '';
      const sql = `${connectionInfo}SELECT * FROM "${item.data.schema}"."${item.data.table}" LIMIT 100;\n`;
      const doc = await vscode.workspace.openTextDocument({
        language: 'sql',
        content: sql,
      });
      await vscode.window.showTextDocument(doc);
      if (item.data.connectionId) {
        documentConnectionTracker.associateDocumentWithConnection(doc, item.data.connectionId);
      }
    }),
  ];

  context.subscriptions.push(
    ...commands,
    connectionsView,
    historyView,
    completionDisposable,
    hoverDisposable,
    formatDisposable,
    rangeFormatDisposable,
    resultsViewDisposable,
    {
      dispose: () => {
        connectionManager.disconnectAll();
        connectionManager.dispose();
        queryExecutor.dispose();
        connectionTreeProvider.dispose();
        queryHistoryProvider.dispose();
        resultsViewProvider.dispose();
        documentConnectionTracker.dispose();
      },
    }
  );
}

export function deactivate() {
  console.log('PostgreSQL Client is now deactivated');
}
