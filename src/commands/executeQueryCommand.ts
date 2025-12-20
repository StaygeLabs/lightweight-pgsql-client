import * as vscode from 'vscode';
import { QueryExecutor } from '../services/queryExecutor';
import { ResultsViewProvider } from '../views/resultsPanel';
import { DocumentConnectionTracker } from '../services/documentConnectionTracker';

export async function executeQueryCommand(
  queryExecutor: QueryExecutor,
  resultsViewProvider: ResultsViewProvider,
  documentConnectionTracker: DocumentConnectionTracker
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const document = editor.document;
  const selection = editor.selection;

  // Get the effective connection for this document
  const connection = documentConnectionTracker.getEffectiveConnection(document);
  if (!connection) {
    const result = await vscode.window.showWarningMessage(
      'No connection available for this document. Would you like to select one?',
      'Select Connection',
      'Create Connection'
    );
    if (result === 'Select Connection') {
      await documentConnectionTracker.switchDocumentConnection();
    } else if (result === 'Create Connection') {
      await vscode.commands.executeCommand('pgsql.connect');
    }
    return;
  }

  let sql: string;

  if (!selection.isEmpty) {
    // If text is selected, execute the selected text
    sql = document.getText(selection);
  } else {
    // Find the SQL statement at the current cursor position
    sql = findSqlAtCursor(document, selection.active);
  }

  // Remove comments from SQL
  sql = stripSqlComments(sql).trim();

  if (!sql) {
    vscode.window.showWarningMessage('No SQL to execute');
    return;
  }

  // If multiple statements, only execute the first one
  const statements = splitSqlStatements(sql);
  if (statements.length > 1) {
    sql = statements[0].trim();
    vscode.window.showInformationMessage(
      `Multiple statements detected. Executing only the first statement.`
    );
  }

  // Check if this is a modification query and confirm with user
  if (isModificationQuery(sql)) {
    const confirmed = await showModificationConfirmation(sql, connection.config.name);
    if (!confirmed) {
      return;
    }
  }

  // For SELECT queries without LIMIT, add LIMIT 100
  const originalSql = sql;
  let isLimited = false;
  if (isSelectQuery(sql) && !hasLimitClause(sql)) {
    sql = addLimitClause(sql, 100);
    isLimited = true;
  }

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Executing on ${connection.config.name}...`,
        cancellable: false,
      },
      async () => {
        // Use the document's connection ID
        return await queryExecutor.execute(sql, connection.id);
      }
    );

    // Check if there might be more data
    const hasMoreData = isLimited && result.rowCount >= 100;

    resultsViewProvider.show(result, sql, connection.config.name, {
      connectionId: connection.id,
      originalSql: hasMoreData ? originalSql : undefined,
      hasMoreData,
    });

    const message = result.error
      ? `Query failed: ${result.error}`
      : `[${connection.config.name}] ${result.rowCount} rows in ${result.duration}ms`;

    if (result.error) {
      vscode.window.showErrorMessage(message);
    } else {
      vscode.window.setStatusBarMessage(message, 5000);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`[${connection.config.name}] Query failed: ${message}`);
  }
}

/**
 * Find the SQL statement at the cursor position.
 * SQL statements are separated by semicolons.
 */
function findSqlAtCursor(document: vscode.TextDocument, position: vscode.Position): string {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Find all SQL statements (split by semicolon, but handle strings and comments)
  const statements = splitSqlStatements(text);

  let currentOffset = 0;
  for (const statement of statements) {
    const statementStart = currentOffset;
    const statementEnd = currentOffset + statement.length;

    // Check if cursor is within this statement
    if (offset >= statementStart && offset <= statementEnd) {
      return statement.trim();
    }

    // Move past the statement and the semicolon
    currentOffset = statementEnd;
    // Skip the semicolon if present
    if (text[currentOffset] === ';') {
      currentOffset++;
    }
    // Skip whitespace between statements
    while (currentOffset < text.length && /\s/.test(text[currentOffset])) {
      currentOffset++;
    }
  }

  // If no statement found, return the entire document (fallback)
  return text.trim();
}

/**
 * Split SQL text into individual statements, respecting strings and comments.
 */
function splitSqlStatements(text: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    // Handle line comments
    if (!inString && !inBlockComment && char === '-' && nextChar === '-') {
      inLineComment = true;
      current += char;
      continue;
    }

    if (inLineComment) {
      current += char;
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    // Handle block comments
    if (!inString && !inLineComment && char === '/' && nextChar === '*') {
      inBlockComment = true;
      current += char;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && nextChar === '/') {
        current += nextChar;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    // Handle strings
    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (inString) {
      current += char;
      // Check for escaped quote or end of string
      if (char === stringChar) {
        if (nextChar === stringChar) {
          // Escaped quote
          current += nextChar;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    // Handle semicolon (statement separator)
    if (char === ';') {
      if (current.trim()) {
        statements.push(current);
      }
      current = '';
      continue;
    }

    current += char;
  }

  // Add the last statement if it doesn't end with semicolon
  if (current.trim()) {
    statements.push(current);
  }

  return statements;
}

/**
 * Remove comments from SQL while preserving strings.
 */
function stripSqlComments(sql: string): string {
  let result = '';
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    // Handle line comments
    if (!inString && !inBlockComment && char === '-' && nextChar === '-') {
      inLineComment = true;
      i++; // Skip the second '-'
      continue;
    }

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += char; // Keep the newline
      }
      continue;
    }

    // Handle block comments
    if (!inString && !inLineComment && char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++; // Skip the '*'
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++; // Skip the '/'
      }
      continue;
    }

    // Handle strings
    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
      result += char;
      continue;
    }

    if (inString) {
      result += char;
      if (char === stringChar) {
        if (nextChar === stringChar) {
          // Escaped quote
          result += nextChar;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Check if the SQL statement is a data or schema modification query.
 */
function isModificationQuery(sql: string): boolean {
  // Normalize: remove extra whitespace and convert to uppercase for comparison
  const normalizedSql = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  // List of SQL commands that modify data or schema
  const modificationKeywords = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'DROP',
    'ALTER',
    'CREATE',
    'GRANT',
    'REVOKE',
    'VACUUM',
    'REINDEX',
    'CLUSTER',
    'REFRESH MATERIALIZED VIEW',
    'COPY',
  ];

  for (const keyword of modificationKeywords) {
    if (normalizedSql.startsWith(keyword + ' ') || normalizedSql === keyword) {
      return true;
    }
  }

  return false;
}

/**
 * Show a confirmation dialog for modification queries.
 */
async function showModificationConfirmation(
  sql: string,
  connectionName: string
): Promise<boolean> {
  // Truncate SQL for display if too long
  const maxSqlLength = 500;
  const displaySql = sql.length > maxSqlLength
    ? sql.substring(0, maxSqlLength) + '...'
    : sql;

  const result = await vscode.window.showWarningMessage(
    `Connection: ${connectionName}\n\nSQL: ${displaySql}`,
    { modal: true },
    'Execute'
  );

  return result === 'Execute';
}

/**
 * Check if the SQL is a SELECT query.
 */
function isSelectQuery(sql: string): boolean {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim().toUpperCase();
  return normalizedSql.startsWith('SELECT ') || normalizedSql.startsWith('WITH ');
}

/**
 * Check if the SQL has a LIMIT clause.
 */
function hasLimitClause(sql: string): boolean {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim().toUpperCase();
  // Check for LIMIT keyword not inside a subquery or string
  // Simple check: look for LIMIT followed by a number at the end
  return /\bLIMIT\s+\d+\s*(OFFSET\s+\d+)?\s*$/i.test(sql.trim()) ||
         /\bLIMIT\s+\d+\s*$/i.test(sql.trim()) ||
         /\bFETCH\s+(FIRST|NEXT)\s+\d+\s+ROW(S)?\s+ONLY\s*$/i.test(sql.trim());
}

/**
 * Add LIMIT clause to the SQL query.
 */
function addLimitClause(sql: string, limit: number): string {
  // Remove trailing semicolon if present
  let trimmedSql = sql.trim();
  const hadSemicolon = trimmedSql.endsWith(';');
  if (hadSemicolon) {
    trimmedSql = trimmedSql.slice(0, -1).trim();
  }

  return `${trimmedSql} LIMIT ${limit}${hadSemicolon ? ';' : ''}`;
}
