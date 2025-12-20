import * as vscode from 'vscode';
import { SchemaService } from '../services/schemaService';
import { SessionInfo } from '../models/types';

export class SessionsPanel {
  public static currentPanel: SessionsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly schemaService: SchemaService;
  private disposables: vscode.Disposable[] = [];
  private connectionId?: string;
  private connectionName: string;
  private refreshInterval: NodeJS.Timeout | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    schemaService: SchemaService,
    connectionId: string | undefined,
    connectionName: string
  ) {
    this.panel = panel;
    this.schemaService = schemaService;
    this.connectionId = connectionId;
    this.connectionName = connectionName;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'refresh':
            await this.loadContent();
            break;
          case 'cancelSession':
            await this.cancelSession(message.pid);
            break;
          case 'terminateSession':
            await this.terminateSession(message.pid);
            break;
          case 'copyQuery':
            await vscode.env.clipboard.writeText(message.query);
            vscode.window.showInformationMessage('Query copied to clipboard');
            break;
          case 'setAutoRefresh':
            this.setAutoRefresh(message.enabled, message.interval);
            break;
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
    connectionId: string | undefined,
    connectionName: string
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SessionsPanel.currentPanel) {
      SessionsPanel.currentPanel.panel.reveal(column);
      SessionsPanel.currentPanel.updateConnection(connectionId, connectionName);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'pgsql.sessions',
      `Sessions - ${connectionName}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    );

    SessionsPanel.currentPanel = new SessionsPanel(panel, schemaService, connectionId, connectionName);
  }

  private updateConnection(connectionId: string | undefined, connectionName: string): void {
    this.connectionId = connectionId;
    this.connectionName = connectionName;
    this.loadContent();
  }

  private async cancelSession(pid: number): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Cancel query on session PID ${pid}?`,
      { modal: true },
      'Cancel Query'
    );

    if (confirm === 'Cancel Query') {
      try {
        const result = await this.schemaService.cancelSession(pid, this.connectionId);
        if (result) {
          vscode.window.showInformationMessage(`Query cancelled on PID ${pid}`);
        } else {
          vscode.window.showWarningMessage(`Could not cancel query on PID ${pid}`);
        }
        await this.loadContent();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to cancel session: ${message}`);
      }
    }
  }

  private async terminateSession(pid: number): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Terminate session PID ${pid}? This will forcefully close the connection.`,
      { modal: true },
      'Terminate'
    );

    if (confirm === 'Terminate') {
      try {
        const result = await this.schemaService.terminateSession(pid, this.connectionId);
        if (result) {
          vscode.window.showInformationMessage(`Session PID ${pid} terminated`);
        } else {
          vscode.window.showWarningMessage(`Could not terminate PID ${pid}`);
        }
        await this.loadContent();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to terminate session: ${message}`);
      }
    }
  }

  private setAutoRefresh(enabled: boolean, interval: number): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }

    if (enabled && interval > 0) {
      this.refreshInterval = setInterval(() => {
        this.loadContent();
      }, interval * 1000);
    }
  }

  private async loadContent(): Promise<void> {
    this.panel.title = `Sessions - ${this.connectionName}`;

    try {
      const sessions = await this.schemaService.getSessions(this.connectionId);
      this.panel.webview.html = this.getHtml(sessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.html = this.getErrorHtml(message);
    }
  }

  private getHtml(sessions: SessionInfo[]): string {
    const sessionRows = sessions.map(session => {
      const stateClass = this.getStateClass(session.state);
      const duration = session.queryStart ? this.formatDuration(session.queryStart) : '-';
      const queryPreview = this.escapeHtml(session.query).substring(0, 100);
      const fullQuery = this.escapeHtml(session.query);

      return `
        <tr class="${stateClass}">
          <td class="pid">${session.pid}</td>
          <td>${this.escapeHtml(session.database)}</td>
          <td>${this.escapeHtml(session.user)}</td>
          <td>${this.escapeHtml(session.applicationName) || '-'}</td>
          <td>${session.clientAddr || '-'}</td>
          <td><span class="state-badge ${stateClass}">${session.state}</span></td>
          <td>${duration}</td>
          <td class="query-cell">
            <span class="query-preview" title="${fullQuery}">${queryPreview}${session.query.length > 100 ? '...' : ''}</span>
            ${session.query ? `<button class="icon-btn copy-btn" onclick="copyQuery('${fullQuery.replace(/'/g, "\\'")}')">Copy</button>` : ''}
          </td>
          <td class="actions">
            ${session.state === 'active' ? `<button class="btn btn-warning" onclick="cancelSession(${session.pid})">Cancel</button>` : ''}
            <button class="btn btn-danger" onclick="terminateSession(${session.pid})">Kill</button>
          </td>
        </tr>
      `;
    }).join('');

    const activeCount = sessions.filter(s => s.state === 'active').length;
    const idleCount = sessions.filter(s => s.state === 'idle').length;
    const idleInTxCount = sessions.filter(s => s.state === 'idle in transaction').length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header h2 {
      margin: 0;
    }
    .controls {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }
    .stat-item {
      padding: 8px 16px;
      border-radius: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .stat-item.active { background: #4caf50; color: white; }
    .stat-item.idle { background: var(--vscode-badge-background); }
    .stat-item.idle-tx { background: #ff9800; color: white; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    th {
      background: var(--vscode-editor-lineHighlightBackground);
      font-weight: 600;
      position: sticky;
      top: 0;
    }
    tr:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .state-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .state-badge.active { background: #4caf50; color: white; }
    .state-badge.idle { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .state-badge.idle-in-transaction { background: #ff9800; color: white; }
    .state-badge.unknown { background: #9e9e9e; color: white; }
    .query-cell {
      max-width: 300px;
      overflow: hidden;
    }
    .query-preview {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: inline-block;
      max-width: 250px;
      vertical-align: middle;
    }
    .actions {
      white-space: nowrap;
    }
    .btn {
      padding: 4px 8px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      margin-right: 4px;
    }
    .btn-warning {
      background: #ff9800;
      color: white;
    }
    .btn-warning:hover {
      background: #f57c00;
    }
    .btn-danger {
      background: #f44336;
      color: white;
    }
    .btn-danger:hover {
      background: #d32f2f;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .icon-btn {
      background: transparent;
      border: 1px solid var(--vscode-widget-border);
      color: var(--vscode-foreground);
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      margin-left: 4px;
    }
    .icon-btn:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .copy-btn {
      vertical-align: middle;
    }
    .auto-refresh {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .auto-refresh select {
      padding: 4px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }
    .pid {
      font-family: var(--vscode-editor-font-family);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>Database Sessions</h2>
    <div class="controls">
      <div class="auto-refresh">
        <label>
          <input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()">
          Auto-refresh
        </label>
        <select id="refreshInterval" onchange="toggleAutoRefresh()">
          <option value="5">5s</option>
          <option value="10" selected>10s</option>
          <option value="30">30s</option>
          <option value="60">60s</option>
        </select>
      </div>
      <button class="btn btn-primary" onclick="refresh()">Refresh</button>
    </div>
  </div>

  <div class="stats">
    <div class="stat-item">Total: ${sessions.length}</div>
    <div class="stat-item active">Active: ${activeCount}</div>
    <div class="stat-item idle">Idle: ${idleCount}</div>
    <div class="stat-item idle-tx">Idle in TX: ${idleInTxCount}</div>
  </div>

  ${sessions.length > 0 ? `
  <table>
    <thead>
      <tr>
        <th>PID</th>
        <th>Database</th>
        <th>User</th>
        <th>Application</th>
        <th>Client</th>
        <th>State</th>
        <th>Duration</th>
        <th>Query</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${sessionRows}
    </tbody>
  </table>
  ` : `
  <div class="empty-state">
    <p>No active sessions found</p>
  </div>
  `}

  <script>
    const vscode = acquireVsCodeApi();

    function refresh() {
      vscode.postMessage({ type: 'refresh' });
    }

    function cancelSession(pid) {
      vscode.postMessage({ type: 'cancelSession', pid });
    }

    function terminateSession(pid) {
      vscode.postMessage({ type: 'terminateSession', pid });
    }

    function copyQuery(query) {
      vscode.postMessage({ type: 'copyQuery', query });
    }

    function toggleAutoRefresh() {
      const enabled = document.getElementById('autoRefresh').checked;
      const interval = parseInt(document.getElementById('refreshInterval').value);
      vscode.postMessage({ type: 'setAutoRefresh', enabled, interval });
    }
  </script>
</body>
</html>`;
  }

  private getStateClass(state: string): string {
    switch (state) {
      case 'active': return 'active';
      case 'idle': return 'idle';
      case 'idle in transaction': return 'idle-in-transaction';
      default: return 'unknown';
    }
  }

  private formatDuration(startTime: Date): string {
    const now = new Date();
    const start = new Date(startTime);
    const diffMs = now.getTime() - start.getTime();

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;

    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .error {
      text-align: center;
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="error">
    <h3>Error loading sessions</h3>
    <p>${this.escapeHtml(error)}</p>
  </div>
</body>
</html>`;
  }

  public dispose(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    SessionsPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
