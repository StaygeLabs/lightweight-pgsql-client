import * as vscode from 'vscode';
import { QueryExecutor } from '../services/queryExecutor';
import { QueryHistoryItem } from '../models/types';

export class QueryHistoryTreeItem extends vscode.TreeItem {
  constructor(public readonly historyItem: QueryHistoryItem) {
    super(QueryHistoryTreeItem.truncateSql(historyItem.sql), vscode.TreeItemCollapsibleState.None);

    this.tooltip = historyItem.sql;
    this.description = this.formatDescription();
    this.iconPath = historyItem.error
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : new vscode.ThemeIcon('check', new vscode.ThemeColor('successForeground'));

    this.command = {
      command: 'pgsql.openHistoryQuery',
      title: 'Open Query',
      arguments: [historyItem],
    };
  }

  private static truncateSql(sql: string): string {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return normalized.length > 50 ? normalized.substring(0, 50) + '...' : normalized;
  }

  private formatDescription(): string {
    const time = this.historyItem.timestamp.toLocaleTimeString();
    const duration = `${this.historyItem.duration}ms`;
    const rows = this.historyItem.error ? 'Error' : `${this.historyItem.rowCount} rows`;
    return `${time} | ${duration} | ${rows}`;
  }
}

export class QueryHistoryProvider implements vscode.TreeDataProvider<QueryHistoryTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QueryHistoryTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private queryExecutor: QueryExecutor) {
    queryExecutor.onQueryExecuted(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: QueryHistoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): QueryHistoryTreeItem[] {
    const history = this.queryExecutor.getHistory();
    return history.map((item) => new QueryHistoryTreeItem(item));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
