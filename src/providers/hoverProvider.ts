import * as vscode from 'vscode';
import { ConnectionManager } from '../services/connectionManager';
import { SchemaService } from '../services/schemaService';

export class SqlHoverProvider implements vscode.HoverProvider {
  constructor(
    private connectionManager: ConnectionManager,
    private schemaService: SchemaService
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const connection = this.connectionManager.getActiveConnection();
    if (!connection) {
      return null;
    }

    const wordRange = document.getWordRangeAtPosition(position, /\w+/);
    if (!wordRange) {
      return null;
    }

    const word = document.getText(wordRange);

    try {
      // Check if it's a table
      const tableInfo = await this.getTableInfo(connection.id, word);
      if (tableInfo) {
        return new vscode.Hover(tableInfo, wordRange);
      }
    } catch {
      // Ignore errors
    }

    return null;
  }

  private async getTableInfo(
    connectionId: string,
    tableName: string
  ): Promise<vscode.MarkdownString | null> {
    try {
      const schemas = await this.schemaService.getSchemas(connectionId);

      for (const schema of schemas) {
        const tables = await this.schemaService.getTables(schema, connectionId);
        const table = tables.find(
          (t) => t.name.toLowerCase() === tableName.toLowerCase()
        );

        if (table) {
          const columns = await this.schemaService.getColumns(
            schema,
            table.name,
            connectionId
          );

          const md = new vscode.MarkdownString();
          md.appendMarkdown(`### ${table.type === 'view' ? '📋 View' : '📊 Table'}: ${table.name}\n\n`);
          md.appendMarkdown(`**Schema:** ${schema}\n\n`);
          md.appendMarkdown(`| Column | Type | Nullable | Key |\n`);
          md.appendMarkdown(`|--------|------|----------|-----|\n`);

          for (const col of columns) {
            const key = col.isPrimaryKey ? '🔑 PK' : '';
            const nullable = col.nullable ? 'Yes' : 'No';
            md.appendMarkdown(`| ${col.name} | ${col.dataType} | ${nullable} | ${key} |\n`);
          }

          md.isTrusted = true;
          return md;
        }
      }
    } catch {
      // Ignore errors
    }

    return null;
  }
}
