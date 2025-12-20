import { ConnectionManager } from './connectionManager';
import { TableInfo, ColumnDetail, IndexInfo, ForeignKeyInfo, ConstraintInfo, TableStats } from '../models/types';

export class SchemaService {
  constructor(private connectionManager: ConnectionManager) {}

  /**
   * Parse PostgreSQL array result which may come as string "{a,b,c}" or actual array
   */
  private parseArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      // Handle PostgreSQL array format: {item1,item2,item3}
      if (value.startsWith('{') && value.endsWith('}')) {
        const inner = value.slice(1, -1);
        if (inner === '') {
          return [];
        }
        // Handle quoted strings and unquoted values
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < inner.length; i++) {
          const char = inner[i];
          if (char === '"' && !inQuotes) {
            inQuotes = true;
          } else if (char === '"' && inQuotes) {
            if (inner[i + 1] === '"') {
              current += '"';
              i++;
            } else {
              inQuotes = false;
            }
          } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current);
        return result;
      }
    }
    return [];
  }

  async getSchemas(connectionId?: string): Promise<string[]> {
    const sql = `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ORDER BY schema_name
    `;

    const rows = await this.query(sql, connectionId);
    return rows.map((row: { schema_name: string }) => row.schema_name);
  }

  async getTables(schema: string, connectionId?: string): Promise<TableInfo[]> {
    const sql = `
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
    `;

    const rows = await this.query(sql, connectionId, [schema]);
    return rows.map((row: { table_schema: string; table_name: string; table_type: string }) => ({
      schema: row.table_schema,
      name: row.table_name,
      type: row.table_type === 'VIEW' ? 'view' : 'table',
    }));
  }

  async getColumns(schema: string, table: string, connectionId?: string): Promise<ColumnDetail[]> {
    const sql = `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = $1
          AND tc.table_name = $2
          AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `;

    const rows = await this.query(sql, connectionId, [schema, table]);
    return rows.map((row: {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      is_primary_key: boolean;
    }) => ({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      defaultValue: row.column_default,
      isPrimaryKey: row.is_primary_key,
    }));
  }

  async getIndexes(schema: string, table: string, connectionId?: string): Promise<IndexInfo[]> {
    const sql = `
      SELECT
        i.relname AS index_name,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary,
        am.amname AS index_type,
        pg_get_indexdef(i.oid) AS definition,
        pg_get_expr(ix.indpred, ix.indrelid) AS condition
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_am am ON am.oid = i.relam
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = $1
        AND t.relname = $2
      GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname, i.oid, ix.indpred, ix.indrelid
      ORDER BY ix.indisprimary DESC, i.relname
    `;

    const rows = await this.query(sql, connectionId, [schema, table]);
    return rows.map((row: {
      index_name: string;
      columns: unknown;
      is_unique: boolean;
      is_primary: boolean;
      index_type: string;
      definition: string;
      condition: string | null;
    }) => ({
      name: row.index_name,
      columns: this.parseArray(row.columns),
      isUnique: row.is_unique,
      isPrimary: row.is_primary,
      indexType: row.index_type,
      definition: row.definition,
      condition: row.condition ?? undefined,
    }));
  }

  async getForeignKeys(schema: string, table: string, connectionId?: string): Promise<ForeignKeyInfo[]> {
    const sql = `
      SELECT
        tc.constraint_name,
        array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
        ccu.table_schema AS ref_schema,
        ccu.table_name AS ref_table,
        array_agg(ccu.column_name ORDER BY kcu.ordinal_position) AS ref_columns,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      GROUP BY tc.constraint_name, ccu.table_schema, ccu.table_name, rc.update_rule, rc.delete_rule
      ORDER BY tc.constraint_name
    `;

    const rows = await this.query(sql, connectionId, [schema, table]);
    return rows.map((row: {
      constraint_name: string;
      columns: unknown;
      ref_schema: string;
      ref_table: string;
      ref_columns: unknown;
      update_rule: string;
      delete_rule: string;
    }) => ({
      name: row.constraint_name,
      columns: this.parseArray(row.columns),
      referencedSchema: row.ref_schema,
      referencedTable: row.ref_table,
      referencedColumns: this.parseArray(row.ref_columns),
      onUpdate: row.update_rule,
      onDelete: row.delete_rule,
    }));
  }

  async getConstraints(schema: string, table: string, connectionId?: string): Promise<ConstraintInfo[]> {
    const sql = `
      SELECT
        tc.constraint_name,
        tc.constraint_type,
        array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
        pg_get_constraintdef(pgc.oid) AS definition
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN pg_constraint pgc
        ON pgc.conname = tc.constraint_name
      JOIN pg_namespace n
        ON n.oid = pgc.connamespace
        AND n.nspname = tc.table_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
      GROUP BY tc.constraint_name, tc.constraint_type, pgc.oid
      ORDER BY
        CASE tc.constraint_type
          WHEN 'PRIMARY KEY' THEN 1
          WHEN 'UNIQUE' THEN 2
          WHEN 'FOREIGN KEY' THEN 3
          WHEN 'CHECK' THEN 4
          ELSE 5
        END,
        tc.constraint_name
    `;

    const rows = await this.query(sql, connectionId, [schema, table]);
    return rows.map((row: {
      constraint_name: string;
      constraint_type: string;
      columns: unknown;
      definition: string;
    }) => ({
      name: row.constraint_name,
      type: row.constraint_type as ConstraintInfo['type'],
      columns: this.parseArray(row.columns),
      definition: row.definition,
    }));
  }

  async getTableStats(schema: string, table: string, connectionId?: string): Promise<TableStats> {
    const sql = `
      SELECT
        COALESCE(c.reltuples::bigint, 0) AS row_count,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
        pg_size_pretty(pg_table_size(c.oid)) AS table_size,
        pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
        s.last_vacuum,
        s.last_analyze
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = $1 AND c.relname = $2
    `;

    const rows = await this.query(sql, connectionId, [schema, table]);
    if (rows.length === 0) {
      return {
        rowCount: 0,
        totalSize: '0 bytes',
        tableSize: '0 bytes',
        indexSize: '0 bytes',
      };
    }

    const row = rows[0] as {
      row_count: number;
      total_size: string;
      table_size: string;
      index_size: string;
      last_vacuum: Date | null;
      last_analyze: Date | null;
    };

    return {
      rowCount: row.row_count,
      totalSize: row.total_size,
      tableSize: row.table_size,
      indexSize: row.index_size,
      lastVacuum: row.last_vacuum ?? undefined,
      lastAnalyze: row.last_analyze ?? undefined,
    };
  }

  async getTableComment(schema: string, table: string, connectionId?: string): Promise<string | null> {
    const sql = `
      SELECT obj_description(c.oid) AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
    `;

    const rows = await this.query(sql, connectionId, [schema, table]);
    if (rows.length === 0) {
      return null;
    }
    return (rows[0] as { comment: string | null }).comment;
  }

  async getColumnComments(schema: string, table: string, connectionId?: string): Promise<Map<string, string>> {
    const sql = `
      SELECT
        a.attname AS column_name,
        col_description(c.oid, a.attnum) AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = $1
        AND c.relname = $2
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND col_description(c.oid, a.attnum) IS NOT NULL
    `;

    const rows = await this.query(sql, connectionId, [schema, table]);
    const comments = new Map<string, string>();
    for (const row of rows as { column_name: string; comment: string }[]) {
      comments.set(row.column_name, row.comment);
    }
    return comments;
  }

  async getTableDDL(schema: string, table: string, connectionId?: string): Promise<string> {
    const [columns, constraints, indexes, tableComment, columnComments] = await Promise.all([
      this.getColumns(schema, table, connectionId),
      this.getConstraints(schema, table, connectionId),
      this.getIndexes(schema, table, connectionId),
      this.getTableComment(schema, table, connectionId),
      this.getColumnComments(schema, table, connectionId),
    ]);

    let ddl = `-- Table: ${schema}.${table}\n`;
    ddl += `-- Generated: ${new Date().toISOString()}\n\n`;
    ddl += `CREATE TABLE "${schema}"."${table}" (\n`;

    // Columns
    const columnDefs = columns.map((col) => {
      let def = `  "${col.name}" ${col.dataType}`;
      if (!col.nullable) {
        def += ' NOT NULL';
      }
      if (col.defaultValue) {
        def += ` DEFAULT ${col.defaultValue}`;
      }
      return def;
    });

    // Primary key constraint
    const pkConstraint = constraints.find((c) => c.type === 'PRIMARY KEY');
    if (pkConstraint) {
      columnDefs.push(`  CONSTRAINT "${pkConstraint.name}" PRIMARY KEY (${pkConstraint.columns.map((c) => `"${c}"`).join(', ')})`);
    }

    // Unique constraints
    constraints
      .filter((c) => c.type === 'UNIQUE')
      .forEach((c) => {
        columnDefs.push(`  CONSTRAINT "${c.name}" UNIQUE (${c.columns.map((col) => `"${col}"`).join(', ')})`);
      });

    // Check constraints
    constraints
      .filter((c) => c.type === 'CHECK')
      .forEach((c) => {
        columnDefs.push(`  CONSTRAINT "${c.name}" ${c.definition}`);
      });

    // Foreign key constraints
    constraints
      .filter((c) => c.type === 'FOREIGN KEY')
      .forEach((c) => {
        columnDefs.push(`  CONSTRAINT "${c.name}" ${c.definition}`);
      });

    ddl += columnDefs.join(',\n');
    ddl += '\n);\n';

    // Indexes (non-primary)
    const nonPrimaryIndexes = indexes.filter((idx) => !idx.isPrimary);
    if (nonPrimaryIndexes.length > 0) {
      ddl += '\n-- Indexes\n';
      nonPrimaryIndexes.forEach((idx) => {
        ddl += `${idx.definition};\n`;
      });
    }

    // Table comment
    if (tableComment) {
      ddl += '\n-- Table Comment\n';
      ddl += `COMMENT ON TABLE "${schema}"."${table}" IS '${this.escapeString(tableComment)}';\n`;
    }

    // Column comments
    if (columnComments.size > 0) {
      ddl += '\n-- Column Comments\n';
      for (const col of columns) {
        const comment = columnComments.get(col.name);
        if (comment) {
          ddl += `COMMENT ON COLUMN "${schema}"."${table}"."${col.name}" IS '${this.escapeString(comment)}';\n`;
        }
      }
    }

    return ddl;
  }

  private escapeString(str: string): string {
    return str.replace(/'/g, "''");
  }

  private async query(sql: string, connectionId?: string, params?: unknown[]): Promise<unknown[]> {
    const connection = connectionId
      ? this.connectionManager.getConnection(connectionId)
      : this.connectionManager.getActiveConnection();

    if (!connection) {
      throw new Error('No active database connection');
    }

    const result = await connection.pool.query(sql, params);
    return result.rows;
  }
}
