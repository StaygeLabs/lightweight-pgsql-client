import * as vscode from 'vscode';
import { ConnectionConfig } from '../models/types';

export class ConnectionFormPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static resolveConnection: ((config: ConnectionConfig | undefined) => void) | undefined;

  static async show(
    extensionUri: vscode.Uri,
    existingConfig?: Partial<ConnectionConfig>
  ): Promise<ConnectionConfig | undefined> {
    return new Promise((resolve) => {
      this.resolveConnection = resolve;

      const isEditing = !!existingConfig?.id;
      const title = isEditing ? 'Edit PostgreSQL Connection' : 'New PostgreSQL Connection';

      if (this.panel) {
        this.panel.reveal();
      } else {
        this.panel = vscode.window.createWebviewPanel(
          'pgsqlConnectionForm',
          title,
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: false,
          }
        );

        this.panel.onDidDispose(() => {
          this.panel = undefined;
          if (this.resolveConnection) {
            this.resolveConnection(undefined);
            this.resolveConnection = undefined;
          }
        });

        this.panel.webview.onDidReceiveMessage((message) => {
          if (message.type === 'connect') {
            if (this.resolveConnection) {
              this.resolveConnection(message.config as ConnectionConfig);
              this.resolveConnection = undefined;
            }
            this.panel?.dispose();
          } else if (message.type === 'cancel') {
            if (this.resolveConnection) {
              this.resolveConnection(undefined);
              this.resolveConnection = undefined;
            }
            this.panel?.dispose();
          } else if (message.type === 'testConnection') {
            // Test connection could be implemented here
            vscode.window.showInformationMessage('Testing connection...');
          }
        });
      }

      this.panel.webview.html = this.getHtml(existingConfig, isEditing);
    });
  }

  private static getHtml(config?: Partial<ConnectionConfig>, isEditing = false): string {
    const defaults = {
      id: config?.id || '',
      name: config?.name || '',
      host: config?.host || 'localhost',
      port: config?.port || 5432,
      database: config?.database || 'postgres',
      user: config?.user || 'postgres',
      password: config?.password || '',
      ssl: config?.ssl || false,
    };

    const title = isEditing ? 'Edit PostgreSQL Connection' : 'New PostgreSQL Connection';
    const buttonText = isEditing ? 'Save' : 'Connect';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
      max-width: 500px;
      margin: 0 auto;
    }
    h2 {
      margin-top: 0;
      font-weight: 500;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
    }
    input[type="text"],
    input[type="password"],
    input[type="number"] {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      font-size: 13px;
    }
    input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .row {
      display: flex;
      gap: 12px;
    }
    .row .form-group {
      flex: 1;
    }
    .row .form-group.small {
      flex: 0 0 100px;
    }
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .checkbox-group input {
      width: auto;
    }
    .hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .divider {
      border-top: 1px solid var(--vscode-panel-border);
      margin: 20px 0;
      position: relative;
    }
    .divider span {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--vscode-editor-background);
      padding: 0 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .connection-string {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      font-size: 12px;
      font-family: var(--vscode-editor-font-family);
    }
    .buttons {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 20px;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
    }
    button.primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    .quick-connect {
      background: var(--vscode-textBlockQuote-background);
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .quick-connect h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <h2>${title}</h2>

  <div class="quick-connect">
    <h3>Quick Connect (Connection String)</h3>
    <input type="text" id="connString" class="connection-string"
           placeholder="postgresql://user:password@localhost:5432/database">
    <p class="hint">Paste a connection string to auto-fill the form below</p>
  </div>

  <div class="divider"><span>or fill manually</span></div>

  <form id="connectionForm">
    <div class="form-group">
      <label for="name">Connection Name *</label>
      <input type="text" id="name" value="${defaults.name}" placeholder="My Database" required>
    </div>

    <div class="row">
      <div class="form-group">
        <label for="host">Host</label>
        <input type="text" id="host" value="${defaults.host}" placeholder="localhost">
      </div>
      <div class="form-group small">
        <label for="port">Port</label>
        <input type="number" id="port" value="${defaults.port}" placeholder="5432">
      </div>
    </div>

    <div class="form-group">
      <label for="database">Database</label>
      <input type="text" id="database" value="${defaults.database}" placeholder="postgres">
    </div>

    <div class="row">
      <div class="form-group">
        <label for="user">Username</label>
        <input type="text" id="user" value="${defaults.user}" placeholder="postgres">
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" value="${defaults.password}" placeholder="••••••••">
      </div>
    </div>

    <div class="form-group">
      <label class="checkbox-group">
        <input type="checkbox" id="ssl" ${defaults.ssl ? 'checked' : ''}>
        Use SSL
      </label>
    </div>

    <div class="buttons">
      <button type="button" class="secondary" onclick="cancel()">Cancel</button>
      <button type="submit" class="primary">${buttonText}</button>
    </div>
  </form>

  <script>
    const vscode = acquireVsCodeApi();

    // Parse connection string and fill form
    document.getElementById('connString').addEventListener('input', (e) => {
      const str = e.target.value.trim();
      if (!str) return;

      try {
        let url;
        if (str.startsWith('postgresql://') || str.startsWith('postgres://')) {
          url = new URL(str);
        } else {
          return;
        }

        document.getElementById('host').value = url.hostname || 'localhost';
        document.getElementById('port').value = url.port || '5432';
        document.getElementById('database').value = url.pathname.slice(1) || 'postgres';
        document.getElementById('user').value = decodeURIComponent(url.username) || 'postgres';
        document.getElementById('password').value = decodeURIComponent(url.password) || '';
        document.getElementById('ssl').checked = url.searchParams.get('sslmode') === 'require';

        // Auto-generate name
        if (!document.getElementById('name').value) {
          document.getElementById('name').value = url.pathname.slice(1) || url.hostname;
        }
      } catch (err) {
        // Ignore parse errors
      }
    });

    const existingId = '${defaults.id}';

    document.getElementById('connectionForm').addEventListener('submit', (e) => {
      e.preventDefault();

      const config = {
        id: existingId || ('conn_' + Date.now()),
        name: document.getElementById('name').value || 'Unnamed',
        host: document.getElementById('host').value || 'localhost',
        port: parseInt(document.getElementById('port').value) || 5432,
        database: document.getElementById('database').value || 'postgres',
        user: document.getElementById('user').value || 'postgres',
        password: document.getElementById('password').value,
        ssl: document.getElementById('ssl').checked
      };

      vscode.postMessage({ type: 'connect', config });
    });

    function cancel() {
      vscode.postMessage({ type: 'cancel' });
    }

    // Focus on connection string input
    document.getElementById('connString').focus();
  </script>
</body>
</html>`;
  }
}
