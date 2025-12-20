import { QueryResult as PgQueryResult } from 'pg';
import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { QueryResult, ColumnInfo, QueryHistoryItem } from '../models/types';

export class QueryExecutor {
  private queryHistory: QueryHistoryItem[] = [];
  private maxHistoryItems = 100;

  private _onQueryExecuted = new vscode.EventEmitter<QueryHistoryItem>();
  readonly onQueryExecuted = this._onQueryExecuted.event;

  constructor(private connectionManager: ConnectionManager) {}

  async execute(sql: string, connectionId?: string): Promise<QueryResult> {
    const connection = connectionId
      ? this.connectionManager.getConnection(connectionId)
      : this.connectionManager.getActiveConnection();

    if (!connection) {
      throw new Error('No active database connection');
    }

    const startTime = Date.now();
    let result: QueryResult;

    try {
      const pgResult: PgQueryResult = await connection.pool.query(sql);
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
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      result = {
        columns: [],
        rows: [],
        rowCount: 0,
        duration,
        error: errorMessage,
      };

      this.addToHistory({
        id: this.generateId(),
        sql,
        connectionId: connection.id,
        timestamp: new Date(),
        duration,
        rowCount: 0,
        error: errorMessage,
      });

      throw error;
    }

    return result;
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
