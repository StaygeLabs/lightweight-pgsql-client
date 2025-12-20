import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QueryResult } from '../models/types';

export type ExportFormat = 'csv' | 'json' | 'sql';

export class ExportService {
  async export(result: QueryResult, format: ExportFormat): Promise<void> {
    if (result.rows.length === 0) {
      vscode.window.showWarningMessage('No data to export');
      return;
    }

    const defaultFileName = `query_result_${Date.now()}.${format}`;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultFileName),
      filters: this.getFileFilters(format),
    });

    if (!uri) {
      return;
    }

    try {
      const content = this.formatData(result, format);
      fs.writeFileSync(uri.fsPath, content, 'utf8');

      const action = await vscode.window.showInformationMessage(
        `Exported ${result.rows.length} rows to ${path.basename(uri.fsPath)}`,
        'Open File'
      );

      if (action === 'Open File') {
        await vscode.window.showTextDocument(uri);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
  }

  private getFileFilters(format: ExportFormat): Record<string, string[]> {
    switch (format) {
      case 'csv':
        return { 'CSV Files': ['csv'] };
      case 'json':
        return { 'JSON Files': ['json'] };
      case 'sql':
        return { 'SQL Files': ['sql'] };
    }
  }

  private formatData(result: QueryResult, format: ExportFormat): string {
    switch (format) {
      case 'csv':
        return this.toCsv(result);
      case 'json':
        return this.toJson(result);
      case 'sql':
        return this.toSql(result);
    }
  }

  private toCsv(result: QueryResult): string {
    const columns = result.columns.map((c) => c.name);
    const header = columns.map((c) => this.escapeCsvField(c)).join(',');

    const rows = result.rows.map((row) =>
      columns.map((col) => this.escapeCsvField(this.formatValue(row[col]))).join(',')
    );

    return [header, ...rows].join('\n');
  }

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private toJson(result: QueryResult): string {
    return JSON.stringify(result.rows, null, 2);
  }

  private toSql(result: QueryResult): string {
    if (result.rows.length === 0) {
      return '-- No data';
    }

    const columns = result.columns.map((c) => c.name);
    const tableName = 'table_name'; // Placeholder

    const inserts = result.rows.map((row) => {
      const values = columns.map((col) => this.formatSqlValue(row[col])).join(', ');
      return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values});`;
    });

    return `-- Generated INSERT statements\n-- Replace 'table_name' with actual table name\n\n${inserts.join('\n')}`;
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  private formatSqlValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }
}
