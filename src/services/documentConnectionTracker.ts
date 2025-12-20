import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { Connection } from '../models/types';

/**
 * Tracks which connection is associated with each SQL document
 * and provides document-specific connection management
 */
export class DocumentConnectionTracker implements vscode.Disposable {
  private documentConnections = new Map<string, string>(); // document URI -> connection ID
  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem;

  private _onDocumentConnectionChanged = new vscode.EventEmitter<{
    document: vscode.TextDocument;
    connectionId: string | undefined;
  }>();
  readonly onDocumentConnectionChanged = this._onDocumentConnectionChanged.event;

  constructor(private connectionManager: ConnectionManager) {
    // Create status bar item for document connection
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99
    );
    this.statusBarItem.command = 'pgsql.switchDocumentConnection';

    // Track when SQL documents are activated
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateStatusBar(editor);
      })
    );

    // Clean up when documents are closed
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.documentConnections.delete(doc.uri.toString());
      })
    );

    // Update status bar when connections change
    this.disposables.push(
      connectionManager.onConnectionsChanged(() => {
        this.updateStatusBar(vscode.window.activeTextEditor);
      })
    );

    this.disposables.push(
      connectionManager.onConnectionStatusChanged(() => {
        this.updateStatusBar(vscode.window.activeTextEditor);
      })
    );

    // Initial update
    this.updateStatusBar(vscode.window.activeTextEditor);
  }

  /**
   * Associate a document with a specific connection
   */
  setDocumentConnection(document: vscode.TextDocument, connectionId: string): void {
    if (!this.isSqlDocument(document)) {
      return;
    }

    const uriString = document.uri.toString();
    this.documentConnections.set(uriString, connectionId);
    this._onDocumentConnectionChanged.fire({ document, connectionId });
    this.updateStatusBar(vscode.window.activeTextEditor);
  }

  /**
   * Associate a document with a connection (uses first available if not specified)
   */
  associateDocumentWithConnection(document: vscode.TextDocument, connectionId?: string): void {
    if (!this.isSqlDocument(document)) {
      return;
    }

    const uriString = document.uri.toString();
    const connId = connectionId || this.connectionManager.getFirstConnection()?.id;

    if (connId) {
      this.documentConnections.set(uriString, connId);
      this._onDocumentConnectionChanged.fire({ document, connectionId: connId });
      this.updateStatusBar(vscode.window.activeTextEditor);
    }
  }

  /**
   * Get the connection ID for a document
   */
  getDocumentConnectionId(document: vscode.TextDocument): string | undefined {
    return this.documentConnections.get(document.uri.toString());
  }

  /**
   * Get the connection for a document (returns undefined if no connection set)
   */
  getDocumentConnection(document: vscode.TextDocument): Connection | undefined {
    const connectionId = this.getDocumentConnectionId(document);
    if (connectionId) {
      return this.connectionManager.getConnection(connectionId);
    }
    return undefined;
  }

  /**
   * Get the effective connection for a document
   * Returns the document's connection if set, otherwise returns undefined
   */
  getEffectiveConnection(document: vscode.TextDocument): Connection | undefined {
    return this.getDocumentConnection(document);
  }

  /**
   * Check if document has a specific connection set
   */
  hasDocumentConnection(document: vscode.TextDocument): boolean {
    return this.documentConnections.has(document.uri.toString());
  }

  /**
   * Clear the connection for a document
   */
  clearDocumentConnection(document: vscode.TextDocument): void {
    const uriString = document.uri.toString();
    if (this.documentConnections.has(uriString)) {
      this.documentConnections.delete(uriString);
      this._onDocumentConnectionChanged.fire({ document, connectionId: undefined });
      this.updateStatusBar(vscode.window.activeTextEditor);
    }
  }

  /**
   * Switch the connection for the current document via Quick Pick
   */
  async switchDocumentConnection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isSqlDocument(editor.document)) {
      vscode.window.showWarningMessage('Please open a SQL document first');
      return;
    }

    const savedConfigs = this.connectionManager.getSavedConnectionConfigs();
    if (savedConfigs.length === 0) {
      const result = await vscode.window.showWarningMessage(
        'No connections configured. Please add a connection first.',
        'Add Connection'
      );
      if (result === 'Add Connection') {
        vscode.commands.executeCommand('pgsql.connect');
      }
      return;
    }

    const currentConnId = this.getDocumentConnectionId(editor.document);

    interface ConnectionQuickPickItem extends vscode.QuickPickItem {
      connectionId: string;
      isConnected: boolean;
    }

    const items: ConnectionQuickPickItem[] = savedConfigs.map((config) => {
      const isCurrent = config.id === currentConnId;
      const isConnected = this.connectionManager.isConnected(config.id);
      let description = `${config.host}:${config.port}/${config.database}`;
      if (isCurrent) {
        description += ' (current)';
      }
      if (!isConnected) {
        description += ' - not connected';
      }

      return {
        label: `${isConnected ? '$(database)' : '$(debug-disconnect)'} ${config.name}`,
        description,
        connectionId: config.id,
        isConnected,
        picked: isCurrent,
      };
    });

    // Add option to clear connection
    if (currentConnId) {
      items.unshift({
        label: '$(close) Clear Connection',
        description: 'Remove connection from this document',
        connectionId: '',
        isConnected: false,
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a connection for this document',
      title: 'Switch Document Connection',
    });

    if (selected) {
      if (selected.connectionId === '') {
        this.clearDocumentConnection(editor.document);
        vscode.window.showInformationMessage('Connection cleared from document');
      } else {
        // If not connected, connect first
        if (!selected.isConnected) {
          try {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: 'Connecting...',
                cancellable: false,
              },
              async () => {
                await this.connectionManager.connectById(selected.connectionId);
              }
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== 'Password required') {
              vscode.window.showErrorMessage(`Failed to connect: ${message}`);
            }
            return;
          }
        }

        this.setDocumentConnection(editor.document, selected.connectionId);
        const config = savedConfigs.find((c) => c.id === selected.connectionId);
        vscode.window.showInformationMessage(`Switched to: ${config?.name}`);
      }
    }
  }

  private updateStatusBar(editor: vscode.TextEditor | undefined): void {
    if (!editor || !this.isSqlDocument(editor.document)) {
      this.statusBarItem.hide();
      return;
    }

    const docConnection = this.getDocumentConnection(editor.document);

    if (docConnection) {
      this.statusBarItem.text = `$(link) ${docConnection.config.name}`;
      this.statusBarItem.tooltip = `Document Connection: ${docConnection.config.name}\n${docConnection.config.host}:${docConnection.config.port}/${docConnection.config.database}\n\nClick to change`;
      this.statusBarItem.backgroundColor = undefined;
    } else {
      const hasConnectionId = this.hasDocumentConnection(editor.document);
      if (hasConnectionId) {
        // Connection was set but is now disconnected
        this.statusBarItem.text = '$(warning) Disconnected';
        this.statusBarItem.tooltip = 'The connection for this document is no longer active\nClick to select a new connection';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        this.statusBarItem.text = '$(plug) No Connection';
        this.statusBarItem.tooltip = 'No connection set for this document\nClick to select a connection';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      }
    }

    this.statusBarItem.show();
  }

  private isSqlDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'sql' || document.languageId === 'pgsql';
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this._onDocumentConnectionChanged.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.documentConnections.clear();
  }
}
