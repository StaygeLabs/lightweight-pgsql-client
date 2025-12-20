import * as vscode from 'vscode';
import { SchemaService } from '../services/schemaService';
import { ColumnDetail, IndexInfo, ForeignKeyInfo, ConstraintInfo, TableStats } from '../models/types';

export class TableInfoPanel {
  public static currentPanel: TableInfoPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly schemaService: SchemaService;
  private disposables: vscode.Disposable[] = [];

  private schema: string;
  private table: string;
  private connectionId?: string;

  private constructor(
    panel: vscode.WebviewPanel,
    schemaService: SchemaService,
    schema: string,
    table: string,
    connectionId?: string
  ) {
    this.panel = panel;
    this.schemaService = schemaService;
    this.schema = schema;
    this.table = table;
    this.connectionId = connectionId;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.type === 'copy') {
          await vscode.env.clipboard.writeText(message.text);
          vscode.window.showInformationMessage('Copied to clipboard');
        } else if (message.type === 'copyDDL') {
          const ddl = await this.schemaService.getTableDDL(this.schema, this.table, this.connectionId);
          await vscode.env.clipboard.writeText(ddl);
          vscode.window.showInformationMessage('DDL copied to clipboard');
        } else if (message.type === 'openDDL') {
          const ddl = await this.schemaService.getTableDDL(this.schema, this.table, this.connectionId);
          const doc = await vscode.workspace.openTextDocument({
            language: 'sql',
            content: ddl,
          });
          await vscode.window.showTextDocument(doc);
        }
      },
      null,
      this.disposables
    );

    this.loadContent();
  }

  public static async show(
    extensionUri: vscode.Uri,
    schemaService: SchemaService,
    schema: string,
    table: string,
    connectionId?: string
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TableInfoPanel.currentPanel) {
      TableInfoPanel.currentPanel.panel.reveal(column);
      TableInfoPanel.currentPanel.updateTable(schema, table, connectionId);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'pgsql.tableInfo',
      `${schema}.${table}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    );

    TableInfoPanel.currentPanel = new TableInfoPanel(panel, schemaService, schema, table, connectionId);
  }

  private updateTable(schema: string, table: string, connectionId?: string): void {
    this.schema = schema;
    this.table = table;
    this.connectionId = connectionId;
    this.loadContent();
  }

  private async loadContent(): Promise<void> {
    this.panel.title = `${this.schema}.${this.table}`;
    this.panel.webview.html = this.getLoadingHtml();

    try {
      const [columns, indexes, foreignKeys, constraints, stats, tableComment, columnComments] = await Promise.all([
        this.schemaService.getColumns(this.schema, this.table, this.connectionId),
        this.schemaService.getIndexes(this.schema, this.table, this.connectionId),
        this.schemaService.getForeignKeys(this.schema, this.table, this.connectionId),
        this.schemaService.getConstraints(this.schema, this.table, this.connectionId),
        this.schemaService.getTableStats(this.schema, this.table, this.connectionId),
        this.schemaService.getTableComment(this.schema, this.table, this.connectionId),
        this.schemaService.getColumnComments(this.schema, this.table, this.connectionId),
      ]);

      this.panel.webview.html = this.getHtml(columns, indexes, foreignKeys, constraints, stats, tableComment, columnComments);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.html = this.getErrorHtml(message);
    }
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .loading {
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="loading">
    <p>Loading table information...</p>
  </div>
</body>
</html>`;
  }

  private getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
    }
    .error {
      color: var(--vscode-errorForeground);
      background-color: var(--vscode-inputValidation-errorBackground);
      padding: 12px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="error">
    <strong>Error loading table information:</strong><br>
    ${this.escapeHtml(error)}
  </div>
</body>
</html>`;
  }

  private getHtml(
    columns: ColumnDetail[],
    indexes: IndexInfo[],
    foreignKeys: ForeignKeyInfo[],
    constraints: ConstraintInfo[],
    stats: TableStats,
    tableComment: string | null,
    columnComments: Map<string, string>
  ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.schema}.${this.table}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
      line-height: 1.5;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 16px 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 .icon { font-size: 24px; }
    h2 {
      font-size: 14px;
      margin: 24px 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
    }
    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    button {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 6px 12px;
      cursor: pointer;
      border-radius: 3px;
      font-size: 12px;
    }
    button:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    button.primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background-color: var(--vscode-editor-lineHighlightBackground);
      padding: 12px;
      border-radius: 4px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 16px;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 8px;
    }
    th, td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    th {
      background-color: var(--vscode-editor-lineHighlightBackground);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    tr:hover td {
      background-color: var(--vscode-list-hoverBackground);
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-pk {
      background-color: var(--vscode-charts-yellow);
      color: #000;
    }
    .badge-unique {
      background-color: var(--vscode-charts-blue);
      color: #fff;
    }
    .badge-fk {
      background-color: var(--vscode-charts-green);
      color: #fff;
    }
    .badge-nullable {
      background-color: var(--vscode-descriptionForeground);
      color: var(--vscode-editor-background);
    }
    .badge-notnull {
      background-color: var(--vscode-charts-orange);
      color: #fff;
    }
    .type {
      color: var(--vscode-debugTokenExpression-string);
      font-family: var(--vscode-editor-font-family);
    }
    .default {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    .definition {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      word-break: break-all;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 16px;
      text-align: center;
    }
    .section {
      margin-bottom: 24px;
    }
    .columns-list {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .column-chip {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
    }
    .ref-arrow {
      color: var(--vscode-descriptionForeground);
      margin: 0 4px;
    }
    .table-comment {
      background-color: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      padding: 8px 12px;
      margin-bottom: 16px;
      font-size: 13px;
      color: var(--vscode-foreground);
    }
    .column-comment {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <h1>
    <span class="icon">📋</span>
    <span>${this.escapeHtml(this.schema)}.${this.escapeHtml(this.table)}</span>
  </h1>

  <div class="toolbar">
    <button class="primary" onclick="openDDL()">View DDL</button>
    <button onclick="copyDDL()">Copy DDL</button>
  </div>

  ${tableComment ? `<div class="table-comment">${this.escapeHtml(tableComment)}</div>` : ''}

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Rows (estimated)</div>
      <div class="stat-value">${stats.rowCount.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Size</div>
      <div class="stat-value">${stats.totalSize}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Table Size</div>
      <div class="stat-value">${stats.tableSize}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Index Size</div>
      <div class="stat-value">${stats.indexSize}</div>
    </div>
  </div>

  <div class="section">
    <h2>Columns (${columns.length})</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 40px;">#</th>
          <th>Name</th>
          <th>Type</th>
          <th>Nullable</th>
          <th>Default</th>
          <th>Attributes</th>
          <th>Comment</th>
        </tr>
      </thead>
      <tbody>
        ${columns.map((col, idx) => {
          const comment = columnComments.get(col.name);
          return `
          <tr>
            <td style="color: var(--vscode-descriptionForeground);">${idx + 1}</td>
            <td><strong>${this.escapeHtml(col.name)}</strong></td>
            <td><span class="type">${this.escapeHtml(col.dataType)}</span></td>
            <td>${col.nullable
              ? '<span class="badge badge-nullable">NULL</span>'
              : '<span class="badge badge-notnull">NOT NULL</span>'}</td>
            <td>${col.defaultValue
              ? `<span class="default">${this.escapeHtml(col.defaultValue)}</span>`
              : ''}</td>
            <td>${col.isPrimaryKey ? '<span class="badge badge-pk">PK</span>' : ''}</td>
            <td>${comment
              ? `<span class="column-comment" title="${this.escapeHtml(comment)}">${this.escapeHtml(comment)}</span>`
              : ''}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Indexes (${indexes.length})</h2>
    ${indexes.length === 0
      ? '<div class="empty">No indexes defined</div>'
      : `<table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Columns</th>
              <th>Type</th>
              <th>Attributes</th>
              <th>Condition</th>
            </tr>
          </thead>
          <tbody>
            ${indexes.map((idx) => `
              <tr>
                <td><strong>${this.escapeHtml(idx.name)}</strong></td>
                <td>
                  <div class="columns-list">
                    ${idx.columns.map((c) => `<span class="column-chip">${this.escapeHtml(c)}</span>`).join('')}
                  </div>
                </td>
                <td><span class="type">${this.escapeHtml(idx.indexType)}</span></td>
                <td>
                  ${idx.isPrimary ? '<span class="badge badge-pk">PRIMARY</span> ' : ''}
                  ${idx.isUnique && !idx.isPrimary ? '<span class="badge badge-unique">UNIQUE</span>' : ''}
                </td>
                <td>${idx.condition ? `<span class="definition">WHERE ${this.escapeHtml(idx.condition)}</span>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
  </div>

  <div class="section">
    <h2>Foreign Keys (${foreignKeys.length})</h2>
    ${foreignKeys.length === 0
      ? '<div class="empty">No foreign keys defined</div>'
      : `<table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Columns</th>
              <th>References</th>
              <th>On Update</th>
              <th>On Delete</th>
            </tr>
          </thead>
          <tbody>
            ${foreignKeys.map((fk) => `
              <tr>
                <td><strong>${this.escapeHtml(fk.name)}</strong></td>
                <td>
                  <div class="columns-list">
                    ${fk.columns.map((c) => `<span class="column-chip">${this.escapeHtml(c)}</span>`).join('')}
                  </div>
                </td>
                <td>
                  <strong>${this.escapeHtml(fk.referencedSchema)}.${this.escapeHtml(fk.referencedTable)}</strong>
                  <span class="ref-arrow">→</span>
                  <div class="columns-list" style="display: inline-flex;">
                    ${fk.referencedColumns.map((c) => `<span class="column-chip">${this.escapeHtml(c)}</span>`).join('')}
                  </div>
                </td>
                <td>${this.escapeHtml(fk.onUpdate)}</td>
                <td>${this.escapeHtml(fk.onDelete)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
  </div>

  <div class="section">
    <h2>Constraints (${constraints.length})</h2>
    ${constraints.length === 0
      ? '<div class="empty">No constraints defined</div>'
      : `<table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Definition</th>
            </tr>
          </thead>
          <tbody>
            ${constraints.map((c) => `
              <tr>
                <td><strong>${this.escapeHtml(c.name)}</strong></td>
                <td>
                  ${c.type === 'PRIMARY KEY' ? '<span class="badge badge-pk">PRIMARY KEY</span>' : ''}
                  ${c.type === 'UNIQUE' ? '<span class="badge badge-unique">UNIQUE</span>' : ''}
                  ${c.type === 'FOREIGN KEY' ? '<span class="badge badge-fk">FOREIGN KEY</span>' : ''}
                  ${c.type === 'CHECK' ? '<span class="badge">CHECK</span>' : ''}
                  ${c.type === 'EXCLUDE' ? '<span class="badge">EXCLUDE</span>' : ''}
                </td>
                <td><span class="definition">${this.escapeHtml(c.definition)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function copyDDL() {
      vscode.postMessage({ type: 'copyDDL' });
    }

    function openDDL() {
      vscode.postMessage({ type: 'openDDL' });
    }

    function copy(text) {
      vscode.postMessage({ type: 'copy', text: text });
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public dispose(): void {
    TableInfoPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
