import * as assert from 'assert';
import { SqlFormattingProvider } from '../../providers/formatProvider';
import * as vscode from 'vscode';

suite('SQL Formatter Test Suite', () => {
  const formatter = new SqlFormattingProvider();

  function format(sql: string): string {
    const mockDocument = {
      getText: () => sql,
      positionAt: (offset: number) => {
        const before = sql.substring(0, offset);
        const lines = before.split('\n');
        return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
      },
    } as vscode.TextDocument;

    const edits = formatter.provideDocumentFormattingEdits(
      mockDocument,
      { tabSize: 2, insertSpaces: true },
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }
    );

    if (edits.length === 0) {
      return sql;
    }

    return edits[0].newText;
  }

  test('Should uppercase keywords', () => {
    const input = 'select * from users where id = 1';
    const result = format(input);

    assert.ok(result.includes('SELECT'), 'SELECT should be uppercase');
    assert.ok(result.includes('FROM'), 'FROM should be uppercase');
    assert.ok(result.includes('WHERE'), 'WHERE should be uppercase');
  });

  test('Should format simple SELECT', () => {
    const input = 'select id, name from users';
    const result = format(input);

    assert.ok(result.includes('SELECT'), 'Should contain SELECT');
    assert.ok(result.includes('FROM'), 'Should contain FROM');
  });

  test('Should preserve string literals', () => {
    const input = "select * from users where name = 'John Doe'";
    const result = format(input);

    assert.ok(result.includes("'John Doe'"), 'String literal should be preserved');
  });

  test('Should handle JOIN clauses', () => {
    const input = 'select u.name, o.total from users u left join orders o on u.id = o.user_id';
    const result = format(input);

    assert.ok(result.includes('LEFT JOIN'), 'LEFT JOIN should be uppercase');
    assert.ok(result.includes('ON'), 'ON should be uppercase');
  });
});
