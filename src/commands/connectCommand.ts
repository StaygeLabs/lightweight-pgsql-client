import * as vscode from 'vscode';
import { ConnectionManager } from '../services/connectionManager';
import { ConnectionConfig } from '../models/types';
import { ConnectionFormPanel } from '../views/connectionForm';
import { parseConnectionString } from '../utils/connectionString';
import { getSecretStorage } from '../services/secretStorage';

export async function connectCommand(
  connectionManager: ConnectionManager,
  extensionUri: vscode.Uri
): Promise<void> {
  const savedConnections = connectionManager.getSavedConnectionConfigs();
  const secretStorage = getSecretStorage();

  // Check which connections have saved passwords
  const connectionsWithPasswordInfo = await Promise.all(
    savedConnections.map(async (conn) => ({
      ...conn,
      hasPassword: await secretStorage.hasPassword(conn.id),
    }))
  );

  const items: vscode.QuickPickItem[] = [
    {
      label: '$(add) New Connection',
      description: 'Create a new connection with form',
    },
    {
      label: '$(link) Quick Connect',
      description: 'Connect using connection string',
    },
    ...connectionsWithPasswordInfo.map((conn) => ({
      label: `$(database) ${conn.name}`,
      description: `${conn.host}:${conn.port}/${conn.database}`,
      detail: `User: ${conn.user}${conn.hasPassword ? ' (password saved)' : ''}`,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a connection or create a new one',
  });

  if (!selected) {
    return;
  }

  let config: ConnectionConfig | undefined;

  if (selected.label === '$(add) New Connection') {
    // Open form
    config = await ConnectionFormPanel.show(extensionUri);
    if (config && config.password) {
      // Save password securely
      await secretStorage.storePassword(config.id, config.password);
      await connectionManager.saveConnectionConfig(config);
    }
  } else if (selected.label === '$(link) Quick Connect') {
    // Quick connect with connection string
    config = await promptConnectionString();
    if (config && config.password) {
      // Ask to save
      const save = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Save this connection for later?',
      });
      if (save === 'Yes') {
        await secretStorage.storePassword(config.id, config.password);
        await connectionManager.saveConnectionConfig(config);
      }
    }
  } else {
    // Use saved connection
    const connName = selected.label.replace('$(database) ', '');
    const savedConfig = savedConnections.find((c) => c.name === connName);
    if (!savedConfig) {
      return;
    }

    // Try to get password from secret storage
    let password = await secretStorage.getPassword(savedConfig.id);

    if (!password) {
      // Prompt for password if not saved
      password = await vscode.window.showInputBox({
        prompt: `Enter password for ${savedConfig.name}`,
        password: true,
        placeHolder: 'Password',
      });
      if (password === undefined) {
        return;
      }

      // Ask to save password
      const savePassword = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Save password for future connections?',
      });

      if (savePassword === 'Yes') {
        await secretStorage.storePassword(savedConfig.id, password);
        vscode.window.showInformationMessage('Password saved securely');
      }
    }

    config = { ...savedConfig, password };
  }

  if (!config) {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Connecting to ${config.name}...`,
        cancellable: false,
      },
      async () => {
        await connectionManager.connect(config!);
      }
    );

    vscode.window.showInformationMessage(`Connected to ${config.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to connect: ${message}`);
  }
}

async function promptConnectionString(): Promise<ConnectionConfig | undefined> {
  const connStr = await vscode.window.showInputBox({
    prompt: 'Enter PostgreSQL connection string',
    placeHolder: 'postgresql://user:password@localhost:5432/database',
    ignoreFocusOut: true,
  });

  if (!connStr) {
    return undefined;
  }

  const parsed = parseConnectionString(connStr);
  if (!parsed) {
    vscode.window.showErrorMessage('Invalid connection string format');
    return undefined;
  }

  // Generate name from database or host
  const name = parsed.database || parsed.host || 'Unnamed';

  // Prompt for missing fields
  if (!parsed.user) {
    parsed.user = await vscode.window.showInputBox({
      prompt: 'Username',
      value: 'postgres',
    });
    if (!parsed.user) {
      return undefined;
    }
  }

  if (!parsed.password) {
    parsed.password = await vscode.window.showInputBox({
      prompt: 'Password',
      password: true,
    });
    if (parsed.password === undefined) {
      return undefined;
    }
  }

  const config: ConnectionConfig = {
    id: `conn_${Date.now()}`,
    name,
    host: parsed.host || 'localhost',
    port: parsed.port || 5432,
    database: parsed.database || 'postgres',
    user: parsed.user,
    password: parsed.password,
    ssl: parsed.ssl,
  };

  return config;
}
