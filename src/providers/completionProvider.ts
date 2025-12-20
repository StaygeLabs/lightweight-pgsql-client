import * as vscode from 'vscode';
import { ConnectionManager } from '../services/connectionManager';
import { SchemaService } from '../services/schemaService';
import { TableInfo, ColumnDetail } from '../models/types';

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ILIKE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'INDEX', 'VIEW', 'DROP', 'ALTER', 'ADD', 'COLUMN',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'NULL', 'IS', 'TRUE', 'FALSE', 'BETWEEN', 'EXISTS',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF',
  'CAST', 'EXTRACT', 'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
  'CONSTRAINT', 'CASCADE', 'RESTRICT', 'TRUNCATE', 'VACUUM', 'ANALYZE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'SAVEPOINT',
  'GRANT', 'REVOKE', 'SCHEMA', 'DATABASE', 'EXPLAIN', 'WITH', 'RECURSIVE',
  'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'ANY', 'SOME',
  'RETURNING', 'CONFLICT', 'DO', 'NOTHING', 'EXCLUDED',
];

const PG_TYPES = [
  'integer', 'int', 'bigint', 'smallint', 'serial', 'bigserial',
  'numeric', 'decimal', 'real', 'double precision', 'float',
  'varchar', 'char', 'text', 'character varying',
  'boolean', 'bool',
  'date', 'time', 'timestamp', 'timestamptz', 'interval',
  'uuid', 'json', 'jsonb', 'xml',
  'bytea', 'inet', 'cidr', 'macaddr',
  'array', 'point', 'line', 'polygon', 'circle',
];

interface CachedSchema {
  tables: TableInfo[];
  columns: Map<string, ColumnDetail[]>;
  lastUpdated: number;
}

export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  private schemaCache: Map<string, CachedSchema> = new Map();
  private cacheTTL = 60000; // 1 minute

  constructor(
    private connectionManager: ConnectionManager,
    private schemaService: SchemaService
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);
    const wordRange = document.getWordRangeAtPosition(position);
    const currentWord = wordRange ? document.getText(wordRange) : '';

    const items: vscode.CompletionItem[] = [];

    // SQL Keywords
    items.push(...this.getKeywordCompletions(currentWord));

    // PostgreSQL Types
    items.push(...this.getTypeCompletions(currentWord));

    // Database objects (tables, columns)
    const connection = this.connectionManager.getActiveConnection();
    if (connection) {
      const dbItems = await this.getDatabaseCompletions(
        connection.id,
        textBeforeCursor,
        currentWord
      );
      items.push(...dbItems);
    }

    return items;
  }

  private getKeywordCompletions(currentWord: string): vscode.CompletionItem[] {
    const upperWord = currentWord.toUpperCase();
    return SQL_KEYWORDS
      .filter(kw => kw.startsWith(upperWord))
      .map(keyword => {
        const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
        item.detail = 'SQL Keyword';
        item.sortText = '1' + keyword;
        return item;
      });
  }

  private getTypeCompletions(currentWord: string): vscode.CompletionItem[] {
    const lowerWord = currentWord.toLowerCase();
    return PG_TYPES
      .filter(t => t.startsWith(lowerWord))
      .map(type => {
        const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.TypeParameter);
        item.detail = 'PostgreSQL Type';
        item.sortText = '2' + type;
        return item;
      });
  }

  private async getDatabaseCompletions(
    connectionId: string,
    textBeforeCursor: string,
    currentWord: string
  ): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];

    try {
      const cache = await this.getSchemaCache(connectionId);
      if (!cache) {
        return items;
      }

      // Check context to determine what to suggest
      const contextAnalysis = this.analyzeContext(textBeforeCursor);

      if (contextAnalysis.expectingColumn) {
        // After SELECT, WHERE, SET, etc. - suggest columns
        const tableName = contextAnalysis.tableName;
        if (tableName) {
          const columns = cache.columns.get(tableName.toLowerCase());
          if (columns) {
            items.push(...this.getColumnCompletions(columns, tableName, currentWord));
          }
        }
        // Also suggest all columns from all tables
        for (const [table, columns] of cache.columns) {
          items.push(...this.getColumnCompletions(columns, table, currentWord));
        }
      }

      if (contextAnalysis.expectingTable) {
        // After FROM, JOIN, UPDATE, INTO, etc. - suggest tables
        items.push(...this.getTableCompletions(cache.tables, currentWord));
      }

      // If no specific context, suggest both
      if (!contextAnalysis.expectingColumn && !contextAnalysis.expectingTable) {
        items.push(...this.getTableCompletions(cache.tables, currentWord));
      }
    } catch {
      // Ignore errors in completion
    }

    return items;
  }

  private analyzeContext(text: string): {
    expectingTable: boolean;
    expectingColumn: boolean;
    tableName: string | null;
  } {
    const upperText = text.toUpperCase();
    const words = upperText.split(/\s+/);
    const lastWord = words[words.length - 1] || '';
    const secondLastWord = words[words.length - 2] || '';

    const tableKeywords = ['FROM', 'JOIN', 'UPDATE', 'INTO', 'TABLE'];
    const columnKeywords = ['SELECT', 'WHERE', 'AND', 'OR', 'SET', 'ON', 'BY', 'HAVING'];

    const expectingTable = tableKeywords.includes(lastWord) ||
                          tableKeywords.includes(secondLastWord);
    const expectingColumn = columnKeywords.includes(lastWord) ||
                           columnKeywords.includes(secondLastWord);

    // Try to find table name from FROM clause
    let tableName: string | null = null;
    const fromMatch = text.match(/FROM\s+(\w+)/i);
    if (fromMatch) {
      tableName = fromMatch[1];
    }

    return { expectingTable, expectingColumn, tableName };
  }

  private getTableCompletions(
    tables: TableInfo[],
    currentWord: string
  ): vscode.CompletionItem[] {
    const lowerWord = currentWord.toLowerCase();
    return tables
      .filter(t => t.name.toLowerCase().startsWith(lowerWord))
      .map(table => {
        const item = new vscode.CompletionItem(
          table.name,
          table.type === 'view' ? vscode.CompletionItemKind.Interface : vscode.CompletionItemKind.Class
        );
        item.detail = `${table.type} (${table.schema})`;
        item.documentation = `Schema: ${table.schema}`;
        item.sortText = '0' + table.name;
        return item;
      });
  }

  private getColumnCompletions(
    columns: ColumnDetail[],
    tableName: string,
    currentWord: string
  ): vscode.CompletionItem[] {
    const lowerWord = currentWord.toLowerCase();
    return columns
      .filter(c => c.name.toLowerCase().startsWith(lowerWord))
      .map(col => {
        const item = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
        item.detail = `${col.dataType}${col.isPrimaryKey ? ' (PK)' : ''}`;
        item.documentation = new vscode.MarkdownString(
          `**Table:** ${tableName}\n\n` +
          `**Type:** ${col.dataType}\n\n` +
          `**Nullable:** ${col.nullable ? 'Yes' : 'No'}` +
          (col.defaultValue ? `\n\n**Default:** ${col.defaultValue}` : '')
        );
        item.sortText = '0' + col.name;
        if (col.isPrimaryKey) {
          item.insertText = col.name;
          item.label = { label: col.name, description: 'PK' };
        }
        return item;
      });
  }

  private async getSchemaCache(connectionId: string): Promise<CachedSchema | null> {
    const cached = this.schemaCache.get(connectionId);
    if (cached && Date.now() - cached.lastUpdated < this.cacheTTL) {
      return cached;
    }

    try {
      const schemas = await this.schemaService.getSchemas(connectionId);
      const tables: TableInfo[] = [];
      const columns = new Map<string, ColumnDetail[]>();

      // Fetch tables from all schemas (prioritize 'public')
      for (const schema of schemas) {
        const schemaTables = await this.schemaService.getTables(schema, connectionId);
        tables.push(...schemaTables);

        // Fetch columns for each table
        for (const table of schemaTables) {
          const tableColumns = await this.schemaService.getColumns(schema, table.name, connectionId);
          columns.set(table.name.toLowerCase(), tableColumns);
        }
      }

      const cache: CachedSchema = {
        tables,
        columns,
        lastUpdated: Date.now(),
      };

      this.schemaCache.set(connectionId, cache);
      return cache;
    } catch {
      return null;
    }
  }

  clearCache(): void {
    this.schemaCache.clear();
  }
}
