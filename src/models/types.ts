import { Pool } from 'pg';

export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl?: boolean;
}

export interface Connection {
  id: string;
  config: ConnectionConfig;
  pool: Pool;
  isConnected: boolean;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
  error?: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  dataTypeId: number;
}

export interface TableInfo {
  schema: string;
  name: string;
  type: 'table' | 'view';
}

export interface ColumnDetail {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface QueryHistoryItem {
  id: string;
  sql: string;
  connectionId: string;
  timestamp: Date;
  duration: number;
  rowCount: number;
  error?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  indexType: string;
  definition: string;
  condition?: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedSchema: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface ConstraintInfo {
  name: string;
  type: 'PRIMARY KEY' | 'UNIQUE' | 'CHECK' | 'FOREIGN KEY' | 'EXCLUDE';
  columns: string[];
  definition: string;
}

export interface TableStats {
  rowCount: number;
  totalSize: string;
  tableSize: string;
  indexSize: string;
  lastVacuum?: Date;
  lastAnalyze?: Date;
}
