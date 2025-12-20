import { ConnectionManager } from './connectionManager';
import { ColumnInfo } from '../models/types';

export interface RowChange {
  type: 'update' | 'insert' | 'delete';
  rowIndex: number;
  originalData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  modifiedColumns?: string[];
}

export interface ModificationResult {
  success: boolean;
  affectedRows: number;
  errors: string[];
  executedSql: string[];
}

export class DataModificationService {
  constructor(private connectionManager: ConnectionManager) {}

  /**
   * Apply changes to the database
   */
  async applyChanges(
    changes: RowChange[],
    columns: ColumnInfo[],
    tableName: string,
    primaryKeyColumns: string[],
    connectionId?: string
  ): Promise<ModificationResult> {
    const connection = connectionId
      ? this.connectionManager.getConnection(connectionId)
      : this.connectionManager.getActiveConnection();

    if (!connection) {
      return {
        success: false,
        affectedRows: 0,
        errors: ['No active database connection'],
        executedSql: [],
      };
    }

    if (primaryKeyColumns.length === 0) {
      return {
        success: false,
        affectedRows: 0,
        errors: ['Cannot modify data without primary key columns defined'],
        executedSql: [],
      };
    }

    const result: ModificationResult = {
      success: true,
      affectedRows: 0,
      errors: [],
      executedSql: [],
    };

    // Sort changes: deletes first (in reverse order), then updates, then inserts
    const sortedChanges = [...changes].sort((a, b) => {
      const order = { delete: 0, update: 1, insert: 2 };
      if (order[a.type] !== order[b.type]) {
        return order[a.type] - order[b.type];
      }
      // For deletes, process in reverse order to maintain row indices
      if (a.type === 'delete') {
        return b.rowIndex - a.rowIndex;
      }
      return a.rowIndex - b.rowIndex;
    });

    for (const change of sortedChanges) {
      try {
        let sql: string;
        let params: unknown[];

        switch (change.type) {
          case 'update':
            ({ sql, params } = this.buildUpdateSql(
              tableName,
              change.originalData!,
              change.newData!,
              change.modifiedColumns!,
              primaryKeyColumns,
              columns
            ));
            break;

          case 'insert':
            ({ sql, params } = this.buildInsertSql(
              tableName,
              change.newData!,
              columns
            ));
            break;

          case 'delete':
            ({ sql, params } = this.buildDeleteSql(
              tableName,
              change.originalData!,
              primaryKeyColumns,
              columns
            ));
            break;
        }

        result.executedSql.push(this.formatSqlWithParams(sql, params));
        const queryResult = await connection.pool.query(sql, params);
        result.affectedRows += queryResult.rowCount ?? 0;
      } catch (error) {
        result.success = false;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${change.type} row ${change.rowIndex}: ${message}`);
      }
    }

    return result;
  }

  private buildUpdateSql(
    tableName: string,
    originalData: Record<string, unknown>,
    newData: Record<string, unknown>,
    modifiedColumns: string[],
    primaryKeyColumns: string[],
    columns: ColumnInfo[]
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let paramIndex = 1;

    // SET clause
    const setClauses = modifiedColumns.map((col) => {
      params.push(this.convertValue(newData[col], columns.find((c) => c.name === col)));
      return `"${col}" = $${paramIndex++}`;
    });

    // WHERE clause using primary key
    const whereClauses = primaryKeyColumns.map((col) => {
      const value = originalData[col];
      if (value === null || value === undefined) {
        return `"${col}" IS NULL`;
      }
      params.push(this.convertValue(value, columns.find((c) => c.name === col)));
      return `"${col}" = $${paramIndex++}`;
    });

    const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
    return { sql, params };
  }

  private buildInsertSql(
    tableName: string,
    newData: Record<string, unknown>,
    columns: ColumnInfo[]
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const columnNames: string[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(newData)) {
      if (value !== undefined && value !== '') {
        columnNames.push(`"${key}"`);
        params.push(this.convertValue(value, columns.find((c) => c.name === key)));
        placeholders.push(`$${paramIndex++}`);
      }
    }

    const sql = `INSERT INTO ${tableName} (${columnNames.join(', ')}) VALUES (${placeholders.join(', ')})`;
    return { sql, params };
  }

  private buildDeleteSql(
    tableName: string,
    originalData: Record<string, unknown>,
    primaryKeyColumns: string[],
    columns: ColumnInfo[]
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let paramIndex = 1;

    const whereClauses = primaryKeyColumns.map((col) => {
      const value = originalData[col];
      if (value === null || value === undefined) {
        return `"${col}" IS NULL`;
      }
      params.push(this.convertValue(value, columns.find((c) => c.name === col)));
      return `"${col}" = $${paramIndex++}`;
    });

    const sql = `DELETE FROM ${tableName} WHERE ${whereClauses.join(' AND ')}`;
    return { sql, params };
  }

  /**
   * Format SQL with actual parameter values for logging/history
   */
  private formatSqlWithParams(sql: string, params: unknown[]): string {
    let formattedSql = sql;
    for (let i = params.length; i >= 1; i--) {
      const value = params[i - 1];
      const formattedValue = this.formatValueForSql(value);
      formattedSql = formattedSql.replace(new RegExp(`\\$${i}\\b`, 'g'), formattedValue);
    }
    return formattedSql;
  }

  /**
   * Format a value for display in SQL (with proper quoting)
   */
  private formatValueForSql(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'object') {
      // JSON objects
      const jsonStr = JSON.stringify(value);
      return `'${jsonStr.replace(/'/g, "''")}'`;
    }
    // String values - escape single quotes
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private convertValue(value: unknown, column?: ColumnInfo): unknown {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (typeof value === 'string') {
      // Try to parse JSON for json/jsonb columns
      if (column?.dataType === 'json' || column?.dataType === 'jsonb') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }

      // Convert string 'true'/'false' to boolean for boolean columns
      if (column?.dataType === 'boolean') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
      }

      // Convert string numbers to actual numbers for numeric columns
      const numericTypes = ['integer', 'bigint', 'smallint', 'real', 'double precision', 'numeric', 'decimal'];
      if (column && numericTypes.includes(column.dataType)) {
        const num = Number(value);
        if (!isNaN(num)) return num;
      }
    }

    return value;
  }

  /**
   * Detect primary key columns from the query result
   * This is a heuristic - ideally the user would specify the PK
   */
  detectPrimaryKeyColumns(columns: ColumnInfo[], tableName?: string): string[] {
    // Look for common primary key column names
    const pkCandidates = ['id', 'pk', 'key', 'uuid'];

    for (const candidate of pkCandidates) {
      const found = columns.find(
        (c) => c.name.toLowerCase() === candidate || c.name.toLowerCase().endsWith('_id')
      );
      if (found) {
        return [found.name];
      }
    }

    // If no obvious PK found, return empty (user must specify)
    return [];
  }
}
