import { QueryResult as PgQueryResult, PoolClient } from 'pg';
import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { QueryResult, ColumnInfo, QueryHistoryItem } from '../models/types';

interface ActiveQuery {
  client: PoolClient;
  pid: number;
  connectionId: string;
  cancelled: boolean;
}

export class QueryExecutor {
  private queryHistory: QueryHistoryItem[] = [];
  private maxHistoryItems = 100;
  private activeQuery: ActiveQuery | null = null;

  private _onQueryExecuted = new vscode.EventEmitter<QueryHistoryItem>();
  readonly onQueryExecuted = this._onQueryExecuted.event;

  constructor(private connectionManager: ConnectionManager) {}

  async execute(
    sql: string,
    connectionId?: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<QueryResult> {
    const connection = connectionId
      ? this.connectionManager.getConnection(connectionId)
      : this.connectionManager.getActiveConnection();

    if (!connection) {
      throw new Error('No active database connection');
    }

    const startTime = Date.now();
    let result: QueryResult;
    let client: PoolClient | null = null;

    try {
      // Get a dedicated client from the pool
      client = await connection.pool.connect();

      // Get the backend process ID for cancellation support
      const pidResult = await client.query('SELECT pg_backend_pid() as pid');
      const pid = pidResult.rows[0].pid;

      // Track this query as active
      this.activeQuery = {
        client,
        pid,
        connectionId: connection.id,
        cancelled: false,
      };

      // Set context for UI (show cancel button)
      vscode.commands.executeCommand('setContext', 'pgsql.queryRunning', true);

      // Set up cancellation listener
      let cancellationListener: vscode.Disposable | undefined;
      if (cancellationToken) {
        cancellationListener = cancellationToken.onCancellationRequested(() => {
          this.cancelCurrentQuery();
        });
      }

      try {
        const pgResult: PgQueryResult = await client.query(sql);
        const duration = Date.now() - startTime;

        const columns: ColumnInfo[] = pgResult.fields?.map((field) => ({
          name: field.name,
          dataType: this.getDataTypeName(field.dataTypeID),
          dataTypeId: field.dataTypeID,
        })) ?? [];

        result = {
          columns,
          rows: pgResult.rows ?? [],
          rowCount: pgResult.rowCount ?? 0,
          duration,
        };

        this.addToHistory({
          id: this.generateId(),
          sql,
          connectionId: connection.id,
          timestamp: new Date(),
          duration,
          rowCount: result.rowCount,
        });
      } finally {
        cancellationListener?.dispose();
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this was a cancellation
      const wasCancelled = this.activeQuery?.cancelled ||
        errorMessage.includes('canceling statement due to user request') ||
        errorMessage.includes('57014');

      result = {
        columns: [],
        rows: [],
        rowCount: 0,
        duration,
        error: wasCancelled ? 'Query cancelled by user' : errorMessage,
      };

      if (!wasCancelled) {
        this.addToHistory({
          id: this.generateId(),
          sql,
          connectionId: connection.id,
          timestamp: new Date(),
          duration,
          rowCount: 0,
          error: errorMessage,
        });
      }

      if (!wasCancelled) {
        throw error;
      }
    } finally {
      // Release the client back to the pool
      if (client) {
        client.release();
      }
      this.activeQuery = null;

      // Clear context for UI (hide cancel button)
      vscode.commands.executeCommand('setContext', 'pgsql.queryRunning', false);
    }

    return result;
  }

  /**
   * Cancel the currently running query
   */
  async cancelCurrentQuery(): Promise<boolean> {
    if (!this.activeQuery) {
      return false;
    }

    const { pid, connectionId, cancelled } = this.activeQuery;
    if (cancelled) {
      return false;
    }

    this.activeQuery.cancelled = true;

    try {
      const connection = this.connectionManager.getConnection(connectionId);
      if (connection) {
        // Use pg_cancel_backend to cancel the running query
        await connection.pool.query('SELECT pg_cancel_backend($1)', [pid]);
        return true;
      }
    } catch (error) {
      console.error('Failed to cancel query:', error);
    }

    return false;
  }

  /**
   * Check if a query is currently running
   */
  isQueryRunning(): boolean {
    return this.activeQuery !== null;
  }

  private addToHistory(item: QueryHistoryItem): void {
    this.queryHistory.unshift(item);
    if (this.queryHistory.length > this.maxHistoryItems) {
      this.queryHistory.pop();
    }
    this._onQueryExecuted.fire(item);
  }

  /**
   * Record SQL execution in history (for external use like data modifications)
   */
  recordInHistory(
    sql: string,
    connectionId: string,
    duration: number,
    rowCount: number,
    error?: string
  ): void {
    this.addToHistory({
      id: this.generateId(),
      sql,
      connectionId,
      timestamp: new Date(),
      duration,
      rowCount,
      error,
    });
  }

  getHistory(): QueryHistoryItem[] {
    return [...this.queryHistory];
  }

  clearHistory(): void {
    this.queryHistory = [];
  }

  private generateId(): string {
    return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDataTypeName(oid: number): string {
    const typeMap: Record<number, string> = {
      16: 'boolean',
      20: 'bigint',
      21: 'smallint',
      23: 'integer',
      25: 'text',
      700: 'real',
      701: 'double precision',
      1043: 'varchar',
      1082: 'date',
      1083: 'time',
      1114: 'timestamp',
      1184: 'timestamptz',
      2950: 'uuid',
      3802: 'jsonb',
      114: 'json',
    };
    return typeMap[oid] ?? 'unknown';
  }

  dispose(): void {
    this._onQueryExecuted.dispose();
  }
}
