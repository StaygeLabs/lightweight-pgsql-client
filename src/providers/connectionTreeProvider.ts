import * as vscode from 'vscode';
import { ConnectionManager } from '../services/connectionManager';
import { SchemaService } from '../services/schemaService';
import { ConnectionConfig, TableInfo, ColumnDetail } from '../models/types';

type TreeItemType =
  | 'connection-connected'
  | 'connection-disconnected'
  | 'schema'
  | 'tables'
  | 'views'
  | 'table'
  | 'view'
  | 'column';

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly itemType: TreeItemType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly data?: {
      connectionId?: string;
      schema?: string;
      table?: string;
      column?: ColumnDetail;
    }
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
    this.setIcon();
  }

  private setIcon(): void {
    switch (this.itemType) {
      case 'connection-connected':
        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.green'));
        break;
      case 'connection-disconnected':
        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor('disabledForeground'));
        break;
      case 'schema':
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        break;
      case 'tables':
      case 'views':
        this.iconPath = new vscode.ThemeIcon('folder');
        break;
      case 'table':
        this.iconPath = new vscode.ThemeIcon('symbol-class');
        break;
      case 'view':
        this.iconPath = new vscode.ThemeIcon('eye');
        break;
      case 'column':
        this.iconPath = new vscode.ThemeIcon('symbol-field');
        break;
    }
  }
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];

  constructor(
    private connectionManager: ConnectionManager,
    private schemaService: SchemaService
  ) {
    this.disposables.push(
      connectionManager.onConnectionsChanged(() => this.refresh()),
      connectionManager.onConnectionStatusChanged(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('pgsql.connections')) {
          this.refresh();
        }
      })
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConnectionTreeItem): Promise<ConnectionTreeItem[]> {
    if (!element) {
      return this.getConnections();
    }

    const connectionId = element.data?.connectionId;
    if (!connectionId) {
      return [];
    }

    // Only show children for connected connections
    if (element.itemType === 'connection-disconnected') {
      return [];
    }

    switch (element.itemType) {
      case 'connection-connected':
        return this.getSchemas(connectionId);
      case 'schema':
        return this.getSchemaChildren(connectionId, element.data?.schema!);
      case 'tables':
        return this.getTables(connectionId, element.data?.schema!, 'table');
      case 'views':
        return this.getTables(connectionId, element.data?.schema!, 'view');
      case 'table':
      case 'view':
        return this.getColumns(connectionId, element.data?.schema!, element.data?.table!);
      default:
        return [];
    }
  }

  private getConnections(): ConnectionTreeItem[] {
    const savedConfigs = this.connectionManager.getSavedConnectionConfigs();

    return savedConfigs.map((config: ConnectionConfig) => {
      const isConnected = this.connectionManager.isConnected(config.id);
      const itemType = isConnected ? 'connection-connected' : 'connection-disconnected';
      const collapsibleState = isConnected
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

      const item = new ConnectionTreeItem(
        config.name,
        itemType,
        collapsibleState,
        { connectionId: config.id }
      );

      item.description = `${config.host}:${config.port}/${config.database}`;
      item.tooltip = `${config.user}@${config.host}:${config.port}/${config.database}\n${isConnected ? 'Connected' : 'Disconnected'}`;

      return item;
    });
  }

  private async getSchemas(connectionId: string): Promise<ConnectionTreeItem[]> {
    try {
      const schemas = await this.schemaService.getSchemas(connectionId);
      return schemas.map(
        (schema: string) =>
          new ConnectionTreeItem(schema, 'schema', vscode.TreeItemCollapsibleState.Collapsed, {
            connectionId,
            schema,
          })
      );
    } catch {
      return [];
    }
  }

  private getSchemaChildren(connectionId: string, schema: string): ConnectionTreeItem[] {
    return [
      new ConnectionTreeItem('Tables', 'tables', vscode.TreeItemCollapsibleState.Collapsed, {
        connectionId,
        schema,
      }),
      new ConnectionTreeItem('Views', 'views', vscode.TreeItemCollapsibleState.Collapsed, {
        connectionId,
        schema,
      }),
    ];
  }

  private async getTables(
    connectionId: string,
    schema: string,
    type: 'table' | 'view'
  ): Promise<ConnectionTreeItem[]> {
    try {
      const tables = await this.schemaService.getTables(schema, connectionId);
      return tables
        .filter((t: TableInfo) => t.type === type)
        .map((t: TableInfo) => {
          const item = new ConnectionTreeItem(t.name, type, vscode.TreeItemCollapsibleState.Collapsed, {
            connectionId,
            schema,
            table: t.name,
          });
          item.command = {
            command: 'pgsql.viewTableInfo',
            title: 'View Table Info',
            arguments: [item],
          };
          return item;
        });
    } catch {
      return [];
    }
  }

  private async getColumns(
    connectionId: string,
    schema: string,
    table: string
  ): Promise<ConnectionTreeItem[]> {
    try {
      const columns = await this.schemaService.getColumns(schema, table, connectionId);
      return columns.map((col: ColumnDetail) => {
        const item = new ConnectionTreeItem(
          col.name,
          'column',
          vscode.TreeItemCollapsibleState.None,
          { connectionId, schema, table, column: col }
        );
        item.description = col.dataType;
        if (col.isPrimaryKey) {
          item.iconPath = new vscode.ThemeIcon('key');
        }
        return item;
      });
    } catch {
      return [];
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
