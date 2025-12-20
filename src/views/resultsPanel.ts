import * as vscode from 'vscode';
import { QueryResult, ColumnInfo } from '../models/types';
import { ExportService, ExportFormat } from '../services/exportService';
import { DataModificationService, RowChange } from '../services/dataModificationService';
import { QueryExecutor } from '../services/queryExecutor';

export interface ResultsContext {
  tableName?: string;
  primaryKeyColumns?: string[];
  connectionId?: string;
  editable?: boolean;
  originalSql?: string;
  hasMoreData?: boolean;
}

export class ResultsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'pgsql.resultsView';

  private view?: vscode.WebviewView;
  private currentResult?: QueryResult;
  private currentSql?: string;
  private currentConnectionName?: string;
  private currentContext?: ResultsContext;
  private exportService: ExportService;
  private dataModificationService?: DataModificationService;
  private queryExecutor?: QueryExecutor;

  private _onDataModified = new vscode.EventEmitter<void>();
  readonly onDataModified = this._onDataModified.event;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.exportService = new ExportService();
  }

  setDataModificationService(service: DataModificationService): void {
    this.dataModificationService = service;
  }

  setQueryExecutor(executor: QueryExecutor): void {
    this.queryExecutor = executor;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message);
    });

    // Show empty state initially
    this.updateView();
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'export':
        if (this.currentResult) {
          await this.exportService.export(this.currentResult, message.format as ExportFormat);
        }
        break;

      case 'copy':
        await vscode.env.clipboard.writeText(message.text as string);
        vscode.window.showInformationMessage('Copied to clipboard');
        break;

      case 'saveChanges':
        await this.saveChanges(message.changes as RowChange[]);
        break;

      case 'requestTableInfo':
        await this.promptForTableInfo();
        break;

      case 'showMessage':
        if (message.level === 'error') {
          vscode.window.showErrorMessage(message.text as string);
        } else if (message.level === 'warning') {
          vscode.window.showWarningMessage(message.text as string);
        } else {
          vscode.window.showInformationMessage(message.text as string);
        }
        break;

      case 'viewJson':
        await this.showJsonDocument(message.json as string);
        break;

      case 'viewAll':
        await this.executeFullQuery();
        break;
    }
  }

  private async saveChanges(changes: RowChange[]): Promise<void> {
    if (!this.dataModificationService || !this.currentResult || !this.currentContext) {
      vscode.window.showErrorMessage('Cannot save: missing context');
      return;
    }

    if (!this.currentContext.tableName) {
      await this.promptForTableInfo();
      if (!this.currentContext.tableName) {
        return;
      }
    }

    if (!this.currentContext.primaryKeyColumns || this.currentContext.primaryKeyColumns.length === 0) {
      vscode.window.showErrorMessage('Cannot save: no primary key columns defined');
      return;
    }

    const startTime = Date.now();
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Saving changes...',
        cancellable: false,
      },
      async () => {
        return await this.dataModificationService!.applyChanges(
          changes,
          this.currentResult!.columns,
          this.currentContext!.tableName!,
          this.currentContext!.primaryKeyColumns!,
          this.currentContext!.connectionId
        );
      }
    );
    const duration = Date.now() - startTime;

    // Record executed SQL in query history
    if (this.queryExecutor && this.currentContext.connectionId && result.executedSql.length > 0) {
      const combinedSql = result.executedSql.join(';\n');
      this.queryExecutor.recordInHistory(
        combinedSql,
        this.currentContext.connectionId,
        duration,
        result.affectedRows,
        result.success ? undefined : result.errors.join('; ')
      );
    }

    if (result.success) {
      vscode.window.showInformationMessage(`Changes saved: ${result.affectedRows} rows affected`);
      this._onDataModified.fire();
      // Notify webview to clear dirty state
      this.view?.webview.postMessage({ type: 'changesSaved' });
    } else {
      const errorMsg = result.errors.join('\n');
      vscode.window.showErrorMessage(`Failed to save changes:\n${errorMsg}`);
    }
  }

  private async showJsonDocument(json: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: json,
    });
    await vscode.window.showTextDocument(doc);
  }

  private async executeFullQuery(): Promise<void> {
    if (!this.queryExecutor || !this.currentContext?.originalSql || !this.currentContext?.connectionId) {
      vscode.window.showErrorMessage('Cannot execute full query: missing context');
      return;
    }

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Executing full query...',
          cancellable: false,
        },
        async () => {
          return await this.queryExecutor!.execute(
            this.currentContext!.originalSql!,
            this.currentContext!.connectionId
          );
        }
      );

      // Show result without the hasMoreData flag
      this.show(result, this.currentContext.originalSql, this.currentConnectionName, {
        ...this.currentContext,
        originalSql: undefined,
        hasMoreData: false,
      });

      vscode.window.setStatusBarMessage(
        `Full query: ${result.rowCount} rows in ${result.duration}ms`,
        5000
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Full query failed: ${message}`);
    }
  }

  private async promptForTableInfo(): Promise<void> {
    // Try to extract table name from SQL
    let defaultTableName = '';
    if (this.currentSql) {
      const match = this.currentSql.match(/FROM\s+["']?([^\s"'()]+)["']?/i);
      if (match) {
        defaultTableName = match[1];
      }
    }

    const tableName = await vscode.window.showInputBox({
      prompt: 'Enter the table name (e.g., schema.table or just table)',
      value: defaultTableName,
      placeHolder: 'public.users',
    });

    if (!tableName) {
      return;
    }

    // Detect or ask for primary key
    const columns = this.currentResult?.columns || [];
    const columnNames = columns.map((c) => c.name);

    const pkSelection = await vscode.window.showQuickPick(columnNames, {
      placeHolder: 'Select primary key column(s)',
      canPickMany: true,
      title: 'Select Primary Key Columns',
    });

    if (!pkSelection || pkSelection.length === 0) {
      vscode.window.showWarningMessage('No primary key selected. Editing disabled.');
      return;
    }

    this.currentContext = {
      ...this.currentContext,
      tableName,
      primaryKeyColumns: pkSelection,
      editable: true,
    };

    // Refresh view with editable mode
    this.updateView();
  }

  show(result: QueryResult, sql: string, connectionName?: string, context?: ResultsContext): void {
    this.currentResult = result;
    this.currentSql = sql;
    this.currentConnectionName = connectionName;
    this.currentContext = context || {};

    // Try to detect table name and PK from simple queries
    if (!this.currentContext.tableName && sql) {
      const match = sql.match(/FROM\s+["']?([^\s"'(),]+)["']?/i);
      if (match) {
        this.currentContext.tableName = match[1];
      }
    }

    // Auto-detect primary key columns
    if (!this.currentContext.primaryKeyColumns && result.columns.length > 0) {
      const pkCandidates = result.columns.filter(
        (c) =>
          c.name.toLowerCase() === 'id' ||
          c.name.toLowerCase().endsWith('_id') ||
          c.name.toLowerCase() === 'pk'
      );
      if (pkCandidates.length > 0) {
        this.currentContext.primaryKeyColumns = [pkCandidates[0].name];
        this.currentContext.editable = true;
      }
    }

    if (this.view) {
      this.view.show(true);
      this.updateView();
    }
  }

  private updateView(): void {
    if (!this.view) {
      return;
    }

    if (!this.currentResult || !this.currentSql) {
      this.view.webview.html = this.getEmptyHtml();
      return;
    }

    this.view.webview.html = this.getHtml(
      this.currentResult,
      this.currentSql,
      this.currentConnectionName,
      this.currentContext
    );
  }

  private getEmptyHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-panel-background);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .empty {
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="empty">
    <div class="empty-icon">📊</div>
    <p>Execute a query to see results here</p>
    <p style="font-size: 12px;">Use Cmd+Shift+P → PostgreSQL: Execute Query</p>
  </div>
</body>
</html>`;
  }

  private getHtml(
    result: QueryResult,
    sql: string,
    connectionName?: string,
    context?: ResultsContext
  ): string {
    const rows = result.rows;
    const columns = result.columns;
    const isEditable = context?.editable && context?.tableName && context?.primaryKeyColumns?.length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Query Results</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-panel-background);
      padding: 8px;
      margin: 0;
    }
    .toolbar {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .toolbar-group {
      display: flex;
      gap: 4px;
    }
    .toolbar-divider {
      width: 1px;
      height: 20px;
      background-color: var(--vscode-panel-border);
      margin: 0 4px;
    }
    .info {
      display: flex;
      gap: 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-left: auto;
      align-items: center;
    }
    .connection-badge {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
    }
    .changes-badge {
      background-color: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
    }
    .more-data-badge {
      background-color: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-inputValidation-infoForeground);
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
    }
    .view-all-btn {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 2px 8px;
      cursor: pointer;
      border-radius: 3px;
      font-size: 11px;
    }
    .view-all-btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    button {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 3px 8px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 11px;
    }
    button:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button.primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    button.danger {
      background-color: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-errorForeground);
    }
    .sql-bar {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 6px 8px;
      margin-bottom: 8px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sql-text {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .error {
      color: var(--vscode-errorForeground);
      background-color: var(--vscode-inputValidation-errorBackground);
      padding: 8px;
      border-radius: 3px;
      font-size: 12px;
    }
    .table-container {
      overflow: auto;
      max-height: calc(100vh - 120px);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 4px 8px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border);
      white-space: nowrap;
      max-width: 250px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      background-color: var(--vscode-editor-lineHighlightBackground);
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    th.pk-column {
      color: var(--vscode-charts-yellow);
    }
    tr:hover td {
      background-color: var(--vscode-list-hoverBackground);
    }
    tr.selected td {
      background-color: var(--vscode-editor-selectionBackground) !important;
    }
    tr.deleted td {
      background-color: var(--vscode-inputValidation-errorBackground) !important;
      text-decoration: line-through;
      opacity: 0.7;
    }
    tr.new-row td {
      background-color: var(--vscode-diffEditor-insertedTextBackground) !important;
    }
    td.modified {
      background-color: var(--vscode-diffEditor-insertedTextBackground) !important;
      position: relative;
    }
    td.modified::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 3px;
      height: 100%;
      background-color: var(--vscode-charts-green);
    }
    .row-num {
      color: var(--vscode-descriptionForeground);
      text-align: right;
      width: 40px;
      min-width: 40px;
      max-width: 60px;
      font-size: 11px;
      user-select: none;
      background-color: var(--vscode-editor-lineHighlightBackground);
    }
    .row-checkbox {
      width: 24px;
      text-align: center;
    }
    .null { color: var(--vscode-descriptionForeground); font-style: italic; }
    .json { color: var(--vscode-debugTokenExpression-string); }
    .number { color: var(--vscode-debugTokenExpression-number); }
    .boolean { color: var(--vscode-debugTokenExpression-boolean); }
    .empty-state {
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
    }
    .cell-input {
      background: transparent;
      border: 1px solid transparent;
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      padding: 2px 4px;
      width: 100%;
      min-width: 50px;
    }
    .cell-input:focus {
      border-color: var(--vscode-focusBorder);
      outline: none;
      background-color: var(--vscode-input-background);
    }
    .cell-input:hover {
      border-color: var(--vscode-panel-border);
    }
    .cell-edit-container {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .null-btn {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-descriptionForeground);
      border: none;
      padding: 2px 6px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 10px;
      white-space: nowrap;
    }
    .null-btn:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    .edit-hint {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-group">
      <button onclick="exportData('csv')">CSV</button>
      <button onclick="exportData('json')">JSON</button>
      <button onclick="copyTable()">Copy</button>
    </div>
    ${isEditable ? `
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button class="primary" id="saveBtn" onclick="saveChanges()" disabled>Save Changes</button>
      <button id="addRowBtn" onclick="addNewRow()">+ Add Row</button>
      <button class="danger" id="deleteBtn" onclick="deleteSelectedRows()" disabled>Delete Selected</button>
      <button onclick="discardChanges()">Discard</button>
    </div>
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button id="viewJsonBtn" onclick="viewSelectedAsJson()" disabled>View JSON</button>
    </div>
    ` : `
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button onclick="enableEditing()">Enable Editing</button>
      <button id="viewJsonBtn" onclick="viewSelectedAsJson()" disabled>View JSON</button>
    </div>
    `}
    <div class="info">
      ${connectionName ? `<span class="connection-badge">${this.escapeHtml(connectionName)}</span>` : ''}
      <span id="changesInfo" style="display: none;" class="changes-badge">0 changes</span>
      ${context?.hasMoreData ? `
        <span class="more-data-badge">100+ rows</span>
        <button class="view-all-btn" onclick="viewAllData()">View All</button>
      ` : `<span>${result.rowCount} rows</span>`}
      <span>${result.duration}ms</span>
    </div>
  </div>

  <div class="sql-bar">
    <span class="sql-text" title="${this.escapeAttr(sql)}">${this.escapeHtml(sql.replace(/\s+/g, ' ').trim())}</span>
    <button onclick="copySql()">Copy</button>
  </div>

  ${isEditable ? `<div class="edit-hint">Table: ${context?.tableName} | PK: ${context?.primaryKeyColumns?.join(', ')} | Double-click to edit</div>` : ''}

  ${
    result.error
      ? `<div class="error">${this.escapeHtml(result.error)}</div>`
      : result.rows.length === 0
        ? `<div class="empty-state">${result.rowCount > 0 ? `${result.rowCount} row(s) affected` : 'Query executed successfully. No rows returned.'}</div>`
        : this.renderTable(rows, columns, isEditable, context?.primaryKeyColumns || [])
  }

  <script>
    const vscode = acquireVsCodeApi();
    const sql = ${JSON.stringify(sql)};
    const originalData = ${JSON.stringify(rows)};
    const columns = ${JSON.stringify(columns)};
    const columnNames = ${JSON.stringify(columns.map((c: ColumnInfo) => c.name))};
    const primaryKeyColumns = ${JSON.stringify(context?.primaryKeyColumns || [])};
    const isEditable = ${!!isEditable};

    // State tracking
    let currentData = JSON.parse(JSON.stringify(originalData));
    let modifiedCells = new Map(); // "rowIdx-colName" -> newValue
    let deletedRows = new Set();
    let newRows = []; // { data: {}, tempId: number }
    let selectedRows = new Set();
    let nextTempId = -1;

    function updateUI() {
      const totalChanges = modifiedCells.size + deletedRows.size + newRows.length;
      const changesInfo = document.getElementById('changesInfo');
      const saveBtn = document.getElementById('saveBtn');
      const deleteBtn = document.getElementById('deleteBtn');
      const viewJsonBtn = document.getElementById('viewJsonBtn');

      if (changesInfo) {
        changesInfo.style.display = totalChanges > 0 ? 'inline' : 'none';
        changesInfo.textContent = totalChanges + ' change' + (totalChanges !== 1 ? 's' : '');
      }

      if (saveBtn) {
        saveBtn.disabled = totalChanges === 0;
      }

      if (deleteBtn) {
        deleteBtn.disabled = selectedRows.size === 0;
      }

      if (viewJsonBtn) {
        viewJsonBtn.disabled = selectedRows.size === 0;
      }
    }

    function getCellKey(rowIdx, colName) {
      return rowIdx + '-' + colName;
    }

    function markCellModified(rowIdx, colName, td) {
      const key = getCellKey(rowIdx, colName);
      const newValue = currentData[rowIdx]?.[colName];
      const originalValue = originalData[rowIdx]?.[colName];

      // Compare with type awareness (null vs '' vs value)
      const isModified = newValue !== originalValue &&
        !(newValue === null && originalValue === undefined) &&
        !(newValue === undefined && originalValue === null);

      if (isModified) {
        modifiedCells.set(key, newValue);
        td.classList.add('modified');
      } else {
        modifiedCells.delete(key);
        td.classList.remove('modified');
      }
      updateUI();
    }

    function handleCellEdit(td, rowIdx, colName, isNewRow = false) {
      if (td.querySelector('input')) return;

      const currentRawValue = isNewRow
        ? newRows.find(r => r.tempId === rowIdx)?.data[colName]
        : currentData[rowIdx]?.[colName];
      const isCurrentNull = currentRawValue === null || currentRawValue === undefined;
      const currentValue = isCurrentNull ? '' : formatValue(currentRawValue);

      // Create container
      const container = document.createElement('div');
      container.className = 'cell-edit-container';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cell-input';
      input.value = currentValue;
      input.placeholder = isCurrentNull ? 'NULL' : '';

      const nullBtn = document.createElement('button');
      nullBtn.className = 'null-btn';
      nullBtn.textContent = 'NULL';
      nullBtn.title = 'Set to NULL';

      container.appendChild(input);
      container.appendChild(nullBtn);

      let setToNull = isCurrentNull;

      const originalContent = td.innerHTML;
      td.innerHTML = '';
      td.appendChild(container);
      input.focus();
      input.select();

      const finishEdit = () => {
        const newValue = input.value;
        const finalValue = setToNull ? null : newValue;

        if (finalValue === null) {
          td.innerHTML = '<span class="null">NULL</span>';
        } else {
          td.innerHTML = escapeHtml(newValue);
        }

        if (isNewRow) {
          const row = newRows.find(r => r.tempId === rowIdx);
          if (row) {
            row.data[colName] = finalValue;
          }
        } else {
          currentData[rowIdx][colName] = finalValue;
          markCellModified(rowIdx, colName, td);
        }
      };

      nullBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur on input
        setToNull = true;
        input.value = '';
        input.placeholder = 'NULL';
        input.blur();
      });

      input.addEventListener('blur', (e) => {
        // Delay to allow nullBtn click to process
        setTimeout(() => {
          if (!td.contains(document.activeElement)) {
            finishEdit();
          }
        }, 100);
      });
      input.addEventListener('input', () => {
        // If user types something, it's no longer NULL
        setToNull = false;
        input.placeholder = '';
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          finishEdit();
        } else if (e.key === 'Escape') {
          td.innerHTML = originalContent;
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finishEdit();
          // Move to next cell
          const nextTd = e.shiftKey ? td.previousElementSibling : td.nextElementSibling;
          if (nextTd && nextTd.classList.contains('editable')) {
            nextTd.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          }
        }
      });
    }

    function toggleRowSelection(rowIdx, checkbox, isNewRow = false) {
      const key = isNewRow ? 'new-' + rowIdx : rowIdx;
      const row = checkbox.closest('tr');

      if (checkbox.checked) {
        selectedRows.add(key);
        row.classList.add('selected');
      } else {
        selectedRows.delete(key);
        row.classList.remove('selected');
      }
      updateUI();
    }

    function addNewRow() {
      const tbody = document.querySelector('tbody');
      if (!tbody) return;

      const tempId = nextTempId--;
      const newRowData = {};
      columnNames.forEach(col => newRowData[col] = null);
      newRows.push({ tempId, data: newRowData });

      const tr = document.createElement('tr');
      tr.className = 'new-row';
      tr.dataset.tempId = tempId;

      // Checkbox cell
      const checkboxTd = document.createElement('td');
      checkboxTd.className = 'row-checkbox';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.onchange = () => toggleRowSelection(tempId, checkbox, true);
      checkboxTd.appendChild(checkbox);
      tr.appendChild(checkboxTd);

      // Row number cell
      const rowNumTd = document.createElement('td');
      rowNumTd.className = 'row-num';
      rowNumTd.textContent = 'NEW';
      tr.appendChild(rowNumTd);

      // Data cells
      columnNames.forEach(colName => {
        const td = document.createElement('td');
        td.className = 'editable';
        td.innerHTML = '<span class="null">NULL</span>';
        td.ondblclick = () => handleCellEdit(td, tempId, colName, true);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
      updateUI();

      // Focus on first editable cell
      const firstEditable = tr.querySelector('td.editable');
      if (firstEditable) {
        firstEditable.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      }
    }

    function deleteSelectedRows() {
      if (selectedRows.size === 0) return;

      selectedRows.forEach(key => {
        if (String(key).startsWith('new-')) {
          // Remove new row
          const tempId = parseInt(String(key).replace('new-', ''));
          newRows = newRows.filter(r => r.tempId !== tempId);
          const tr = document.querySelector('tr[data-temp-id="' + tempId + '"]');
          if (tr) tr.remove();
        } else {
          // Mark existing row as deleted
          const rowIdx = parseInt(key);
          deletedRows.add(rowIdx);
          const tr = document.querySelector('tr[data-row="' + rowIdx + '"]');
          if (tr) {
            tr.classList.add('deleted');
            tr.classList.remove('selected');
          }
        }
      });

      selectedRows.clear();
      updateUI();
    }

    function discardChanges() {
      if (modifiedCells.size === 0 && deletedRows.size === 0 && newRows.length === 0) {
        return;
      }

      // Reset modified cells
      modifiedCells.forEach((value, key) => {
        const [rowIdx, colName] = key.split('-');
        const td = document.querySelector('tr[data-row="' + rowIdx + '"] td[data-col="' + colName + '"]');
        if (td) {
          td.classList.remove('modified');
          const originalValue = originalData[rowIdx]?.[colName];
          td.innerHTML = formatCellHtml(originalValue);
        }
      });

      // Restore deleted rows
      deletedRows.forEach(rowIdx => {
        const tr = document.querySelector('tr[data-row="' + rowIdx + '"]');
        if (tr) {
          tr.classList.remove('deleted');
        }
      });

      // Remove new rows
      newRows.forEach(row => {
        const tr = document.querySelector('tr[data-temp-id="' + row.tempId + '"]');
        if (tr) tr.remove();
      });

      // Reset state
      currentData = JSON.parse(JSON.stringify(originalData));
      modifiedCells.clear();
      deletedRows.clear();
      newRows = [];
      selectedRows.clear();

      document.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

      updateUI();
    }

    function saveChanges() {
      const changes = [];

      // Collect updates
      const updatedRows = new Set();
      modifiedCells.forEach((newValue, key) => {
        const [rowIdxStr, colName] = key.split('-');
        const rowIdx = parseInt(rowIdxStr);
        if (!updatedRows.has(rowIdx)) {
          updatedRows.add(rowIdx);
          const modifiedColumns = [];
          modifiedCells.forEach((v, k) => {
            if (k.startsWith(rowIdx + '-')) {
              modifiedColumns.push(k.split('-')[1]);
            }
          });
          changes.push({
            type: 'update',
            rowIndex: rowIdx,
            originalData: originalData[rowIdx],
            newData: currentData[rowIdx],
            modifiedColumns
          });
        }
      });

      // Collect deletes
      deletedRows.forEach(rowIdx => {
        changes.push({
          type: 'delete',
          rowIndex: rowIdx,
          originalData: originalData[rowIdx]
        });
      });

      // Collect inserts
      newRows.forEach(row => {
        changes.push({
          type: 'insert',
          rowIndex: row.tempId,
          newData: row.data
        });
      });

      if (changes.length === 0) {
        vscode.postMessage({ type: 'showMessage', level: 'info', text: 'No changes to save' });
        return;
      }

      vscode.postMessage({ type: 'saveChanges', changes });
    }

    function enableEditing() {
      vscode.postMessage({ type: 'requestTableInfo' });
    }

    function exportData(format) {
      vscode.postMessage({ type: 'export', format });
    }

    function viewAllData() {
      vscode.postMessage({ type: 'viewAll' });
    }

    function copySql() {
      vscode.postMessage({ type: 'copy', text: sql });
    }

    function copyTable() {
      if (originalData.length === 0) return;
      const header = columnNames.join('\\t');
      const rows = originalData.map(row => columnNames.map(col => formatValue(row[col])).join('\\t'));
      const text = [header, ...rows].join('\\n');
      vscode.postMessage({ type: 'copy', text });
    }

    function viewSelectedAsJson() {
      if (selectedRows.size === 0) return;

      const selectedData = [];
      selectedRows.forEach(key => {
        if (String(key).startsWith('new-')) {
          const tempId = parseInt(String(key).replace('new-', ''));
          const row = newRows.find(r => r.tempId === tempId);
          if (row) {
            selectedData.push(row.data);
          }
        } else {
          const rowIdx = parseInt(key);
          if (currentData[rowIdx]) {
            selectedData.push(currentData[rowIdx]);
          }
        }
      });

      const jsonText = JSON.stringify(selectedData.length === 1 ? selectedData[0] : selectedData, null, 2);
      vscode.postMessage({ type: 'viewJson', json: jsonText });
    }

    function formatValue(v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }

    function formatCellHtml(value) {
      if (value === null || value === undefined) {
        return '<span class="null">NULL</span>';
      }
      if (typeof value === 'boolean') {
        return '<span class="boolean">' + value + '</span>';
      }
      if (typeof value === 'number') {
        return '<span class="number">' + value + '</span>';
      }
      if (typeof value === 'object') {
        return '<span class="json">' + escapeHtml(JSON.stringify(value)) + '</span>';
      }
      return escapeHtml(String(value));
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Listen for messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'changesSaved') {
        // Remove modified class from all cells
        document.querySelectorAll('td.modified').forEach(td => {
          td.classList.remove('modified');
        });

        // Remove deleted rows from DOM
        deletedRows.forEach(rowIdx => {
          const tr = document.querySelector('tr[data-row="' + rowIdx + '"]');
          if (tr) tr.remove();
        });

        // Convert new rows to regular rows (update originalData)
        newRows.forEach(row => {
          const tr = document.querySelector('tr[data-temp-id="' + row.tempId + '"]');
          if (tr) {
            tr.classList.remove('new-row');
            tr.removeAttribute('data-temp-id');
          }
        });

        // Update originalData to reflect saved state
        // This prevents showing changes if user edits the same cell again
        Object.assign(originalData, JSON.parse(JSON.stringify(currentData)));

        // Clear dirty state
        modifiedCells.clear();
        deletedRows.clear();
        newRows = [];
        selectedRows.clear();

        // Uncheck all checkboxes
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

        updateUI();
      }
    });

    // Initialize
    updateUI();
  </script>
</body>
</html>`;
  }

  private renderTable(
    rows: Record<string, unknown>[],
    columns: ColumnInfo[],
    isEditable: boolean,
    primaryKeyColumns: string[]
  ): string {
    const tableHeader =
      '<th class="row-checkbox"></th>' +
      '<th class="row-num">#</th>' +
      columns
        .map((col) => {
          const isPk = primaryKeyColumns.includes(col.name);
          return `<th class="${isPk ? 'pk-column' : ''}" title="${this.escapeHtml(col.dataType)}${isPk ? ' (Primary Key)' : ''}">${isPk ? '🔑 ' : ''}${this.escapeHtml(col.name)}</th>`;
        })
        .join('');

    const tableRows = rows
      .map((row, idx) => {
        const cells = columns
          .map((col) => {
            const cellContent = this.formatCell(row[col.name]);
            if (isEditable) {
              return `<td class="editable" data-col="${col.name}" ondblclick="handleCellEdit(this, ${idx}, '${col.name}')">${cellContent}</td>`;
            }
            return `<td title="${this.escapeAttr(this.formatTitle(row[col.name]))}">${cellContent}</td>`;
          })
          .join('');

        const checkboxCell = `<td class="row-checkbox"><input type="checkbox" onchange="toggleRowSelection(${idx}, this)"></td>`;

        return `<tr data-row="${idx}">${checkboxCell}<td class="row-num">${idx + 1}</td>${cells}</tr>`;
      })
      .join('');

    return `<div class="table-container">
      <table>
        <thead><tr>${tableHeader}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
  }

  private formatCell(value: unknown): string {
    if (value === null || value === undefined) {
      return '<span class="null">NULL</span>';
    }
    if (typeof value === 'boolean') {
      return `<span class="boolean">${value}</span>`;
    }
    if (typeof value === 'number') {
      return `<span class="number">${value}</span>`;
    }
    if (typeof value === 'object') {
      return `<span class="json">${this.escapeHtml(JSON.stringify(value))}</span>`;
    }
    return this.escapeHtml(String(value));
  }

  private formatTitle(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeAttr(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
  }

  dispose(): void {
    this._onDataModified.dispose();
  }
}
