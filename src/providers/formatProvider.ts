import * as vscode from 'vscode';

const KEYWORDS_NEWLINE_BEFORE = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY',
  'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT',
  'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'FULL JOIN',
  'CROSS JOIN', 'JOIN', 'ON', 'SET', 'VALUES', 'RETURNING',
];

const KEYWORDS_UPPERCASE = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ILIKE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'INDEX', 'VIEW', 'DROP', 'ALTER', 'ADD', 'COLUMN',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'NULL', 'IS', 'TRUE', 'FALSE', 'BETWEEN', 'EXISTS',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF',
  'CAST', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE',
  'CONSTRAINT', 'CASCADE', 'RESTRICT', 'TRUNCATE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'ANY',
  'RETURNING', 'CONFLICT', 'DO', 'NOTHING', 'EXCLUDED', 'WITH',
];

export class SqlFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): vscode.TextEdit[] {
    const text = document.getText();
    const formatted = this.formatSql(text);

    if (formatted === text) {
      return [];
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(text.length)
    );

    return [vscode.TextEdit.replace(fullRange, formatted)];
  }

  private formatSql(sql: string): string {
    // Preserve string literals and comments
    const preserved: string[] = [];
    let preserveIndex = 0;

    // Replace string literals with placeholders
    let processed = sql.replace(/'([^']*(?:''[^']*)*)'/g, (match) => {
      preserved.push(match);
      return `__STRING_${preserveIndex++}__`;
    });

    // Replace comments with placeholders
    processed = processed.replace(/--[^\n]*/g, (match) => {
      preserved.push(match);
      return `__COMMENT_${preserveIndex++}__`;
    });

    // Normalize whitespace
    processed = processed.replace(/\s+/g, ' ').trim();

    // Uppercase keywords
    for (const keyword of KEYWORDS_UPPERCASE) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      processed = processed.replace(regex, keyword);
    }

    // Add newlines before major keywords
    for (const keyword of KEYWORDS_NEWLINE_BEFORE) {
      const regex = new RegExp(`\\s+(${keyword.replace(' ', '\\s+')})\\b`, 'gi');
      processed = processed.replace(regex, `\n$1`);
    }

    // Format SELECT columns
    processed = this.formatSelectColumns(processed);

    // Format comma-separated items
    processed = processed.replace(/,\s*/g, ',\n    ');

    // Clean up multiple newlines
    processed = processed.replace(/\n\s*\n/g, '\n');

    // Indent clauses
    processed = this.indentClauses(processed);

    // Restore preserved strings and comments
    for (let i = 0; i < preserved.length; i++) {
      processed = processed.replace(`__STRING_${i}__`, preserved[i]);
      processed = processed.replace(`__COMMENT_${i}__`, preserved[i]);
    }

    return processed.trim();
  }

  private formatSelectColumns(sql: string): string {
    // Add newline after SELECT if there are multiple columns
    return sql.replace(/SELECT\s+(.+?)\s+FROM/gi, (match, columns) => {
      if (columns.includes(',')) {
        const formattedColumns = columns.replace(/,\s*/g, ',\n    ');
        return `SELECT\n    ${formattedColumns}\nFROM`;
      }
      return match;
    });
  }

  private indentClauses(sql: string): string {
    const lines = sql.split('\n');
    const indentKeywords = ['AND', 'OR', 'ON'];
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase();

      if (indentKeywords.includes(firstWord)) {
        result.push('    ' + trimmed);
      } else {
        result.push(trimmed);
      }
    }

    return result.join('\n');
  }
}

export class SqlRangeFormattingProvider implements vscode.DocumentRangeFormattingEditProvider {
  private formatter = new SqlFormattingProvider();

  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.TextEdit[] {
    const text = document.getText(range);

    // Create a temporary document with just the selected text
    const tempDoc = {
      getText: () => text,
      positionAt: (offset: number) => {
        const before = text.substring(0, offset);
        const lines = before.split('\n');
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;
        return new vscode.Position(line, character);
      },
    } as vscode.TextDocument;

    const edits = this.formatter.provideDocumentFormattingEdits(tempDoc, options, token);

    if (edits.length === 0) {
      return [];
    }

    // Adjust the range to the original document
    return [vscode.TextEdit.replace(range, edits[0].newText)];
  }
}
