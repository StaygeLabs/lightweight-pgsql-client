import { Pool, PoolConfig } from 'pg';
import * as vscode from 'vscode';
import { Connection, ConnectionConfig } from '../models/types';
import { getSecretStorage } from './secretStorage';

export class ConnectionManager {
  private connections: Map<string, Connection> = new Map();

  private _onConnectionsChanged = new vscode.EventEmitter<void>();
  readonly onConnectionsChanged = this._onConnectionsChanged.event;

  private _onConnectionStatusChanged = new vscode.EventEmitter<string>();
  readonly onConnectionStatusChanged = this._onConnectionStatusChanged.event;

  /**
   * Get all saved connection configs from settings
   */
  getSavedConnectionConfigs(): ConnectionConfig[] {
    const config = vscode.workspace.getConfiguration('pgsql');
    return config.get<ConnectionConfig[]>('connections', []);
  }

  /**
   * Save a connection config to settings
   */
  async saveConnectionConfig(connection: ConnectionConfig): Promise<void> {
    const config = vscode.workspace.getConfiguration('pgsql');
    const connections = config.get<ConnectionConfig[]>('connections', []);

    // Don't save password in settings (it's stored in SecretStorage)
    const toSave = { ...connection, password: undefined };

    const existingIndex = connections.findIndex((c) => c.id === connection.id);
    if (existingIndex >= 0) {
      connections[existingIndex] = toSave;
    } else {
      connections.push(toSave);
    }

    await config.update('connections', connections, vscode.ConfigurationTarget.Global);
    this._onConnectionsChanged.fire();
  }

  /**
   * Delete a connection config from settings
   */
  async deleteConnectionConfig(id: string): Promise<void> {
    // Disconnect first if connected
    if (this.isConnected(id)) {
      await this.disconnect(id);
    }

    // Remove from settings
    const config = vscode.workspace.getConfiguration('pgsql');
    const connections = config.get<ConnectionConfig[]>('connections', []);
    const filtered = connections.filter((c) => c.id !== id);
    await config.update('connections', filtered, vscode.ConfigurationTarget.Global);

    // Remove password from secret storage
    const secretStorage = getSecretStorage();
    await secretStorage.deletePassword(id);

    this._onConnectionsChanged.fire();
  }

  /**
   * Connect to a database using a saved config
   */
  async connectById(id: string): Promise<Connection> {
    const configs = this.getSavedConnectionConfigs();
    const config = configs.find((c) => c.id === id);

    if (!config) {
      throw new Error(`Connection config not found: ${id}`);
    }

    // Get password from secret storage
    const secretStorage = getSecretStorage();
    let password = await secretStorage.getPassword(id);

    if (!password) {
      // Prompt for password
      password = await vscode.window.showInputBox({
        prompt: `Enter password for ${config.name}`,
        password: true,
        placeHolder: 'Password',
      });

      if (password === undefined) {
        throw new Error('Password required');
      }

      // Ask to save password
      const savePassword = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Save password for future connections?',
      });

      if (savePassword === 'Yes') {
        await secretStorage.storePassword(id, password);
      }
    }

    return this.connect({ ...config, password });
  }

  async connect(config: ConnectionConfig): Promise<Connection> {
    if (this.connections.has(config.id)) {
      const existing = this.connections.get(config.id)!;
      if (existing.isConnected) {
        return existing;
      }
      await this.disconnect(config.id);
    }

    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

    const pool = new Pool(poolConfig);

    // Test connection
    const client = await pool.connect();
    client.release();

    const connection: Connection = {
      id: config.id,
      config,
      pool,
      isConnected: true,
    };

    this.connections.set(config.id, connection);
    this._onConnectionsChanged.fire();
    this._onConnectionStatusChanged.fire(config.id);

    return connection;
  }

  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (connection) {
      await connection.pool.end();
      connection.isConnected = false;
      this.connections.delete(id);
      this._onConnectionsChanged.fire();
      this._onConnectionStatusChanged.fire(id);
    }
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map((id) =>
      this.disconnect(id)
    );
    await Promise.all(disconnectPromises);
  }

  getConnection(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  /**
   * Get all currently connected connections
   */
  getAllConnections(): Connection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get the first available connection (for fallback purposes)
   */
  getFirstConnection(): Connection | undefined {
    const connections = this.getAllConnections();
    return connections.length > 0 ? connections[0] : undefined;
  }

  isConnected(id: string): boolean {
    const connection = this.connections.get(id);
    return connection?.isConnected ?? false;
  }

  dispose(): void {
    this._onConnectionsChanged.dispose();
    this._onConnectionStatusChanged.dispose();
  }
}
