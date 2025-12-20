# Lightweight PostgreSQL Client User Manual

## Table of Contents

1. [Getting Started](#getting-started)
2. [Connection Management](#connection-management)
3. [Query Execution](#query-execution)
4. [Schema Explorer](#schema-explorer)
5. [Query Results](#query-results)
6. [Data Editing](#data-editing)
7. [Session Management](#session-management)
8. [Query History](#query-history)
9. [Keyboard Shortcuts](#keyboard-shortcuts)
10. [Settings](#settings)

---

## Getting Started

### Installation

1. Open Extensions tab in VS Code (`Cmd+Shift+X` / `Ctrl+Shift+X`)
2. Search for "Lightweight PostgreSQL Client"
3. Click Install

### First Screen

After installation, a database icon is added to the Activity Bar (left sidebar). Click it to open the PostgreSQL explorer.

---

## Connection Management

### Add New Connection

1. Click the `+` button at the top of the PostgreSQL explorer
2. Choose connection method:
   - **New Connection**: Enter details directly in the form
   - **Quick Connect**: Quick connect with a connection string

### Connection Form Fields

| Field | Description | Example |
|-------|-------------|---------|
| Connection Name | Display name | My Database |
| Host | Server address | localhost |
| Port | Port number | 5432 |
| Database | Database name | postgres |
| Username | User name | postgres |
| Password | Password | ****** |
| Use SSL | Whether to use SSL | Check/Uncheck |

### Connection String Format

```
postgresql://username:password@host:port/database?sslmode=require
```

Example:
```
postgresql://postgres:mypassword@localhost:5432/mydb
```

### Connect/Disconnect

- **Connect**: Click the plug icon on the connection item in the Connections list
- **Disconnect**: Click the disconnect icon on a connected item
- You can also select Connect/Disconnect from the right-click menu

### Edit/Delete Connection

Right-click on a connection item to:
- **Edit Connection**: Modify connection settings
- **Delete Connection**: Delete the connection

### Password Storage

- Passwords are securely stored in VS Code's Secret Storage
- If not saved, you'll need to enter the password each time you connect

---

## Query Execution

### Open SQL File

1. Create a new SQL file: `Cmd+N` → Change language mode to SQL
2. Or click **New Query** button in the PostgreSQL explorer
3. Open an existing `.sql` file

### Execute Query

1. Write SQL statement
2. Execute with:
   - **Shortcut**: `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows/Linux)
   - **Editor top**: Click the run button (▶)
   - **Command Palette**: `PostgreSQL: Execute Query`

### Document-Specific Connection

Each SQL document can have its own connection:

1. Click the connection indicator at the top of the editor or in the status bar
2. Select desired connection
3. If the selected connection is not connected, it will automatically connect

### Partial Execution

- If text is selected, only the selected portion is executed
- If nothing is selected, the SQL statement at cursor position is executed

### Auto LIMIT

- SELECT queries without LIMIT automatically get `LIMIT 100` added
- If results are 100 rows, "100+ rows" indicator and **View More** button appear
- Click **View More** to load next 100 rows incrementally
- Button disappears when all data is loaded

### Query Cancellation

You can cancel a long-running query:

1. **Cancel Button**: Click the stop button (■) in the editor title bar (appears only when query is running)
2. **Command Palette**: `PostgreSQL: Cancel Query`
3. The query is cancelled using PostgreSQL's `pg_cancel_backend()` function

### Multiple SQL Statements

If there are multiple SQL statements separated by semicolons (`;`):
- Only the first statement is executed
- "Multiple statements detected" message is shown

### Data Modification Query Confirmation

When executing data modification queries like INSERT, UPDATE, DELETE:
- A confirmation popup is displayed
- Shows connection name and SQL content
- Click **Execute** to proceed

---

## Schema Explorer

### Structure

After connecting, you can explore the schema with this hierarchy:

```
📁 Connection Name
  └── 📁 schema_name
      ├── 📁 Tables
      │   └── 📋 table_name
      │       ├── column1 (integer)
      │       └── column2 (varchar)
      └── 📁 Views
          └── 👁 view_name
```

### View Table Information

Right-click on a table/view or click the info icon:

- **Columns**: Column list, types, NULL allowance, default values, PK status
- **Indexes**: Index info, unique/primary status, conditions (Partial Index)
- **Foreign Keys**: Foreign key relationships
- **Constraints**: Constraint information
- **Statistics**: Row count, table/index size

### View DDL

In the table info panel:
- **View DDL**: View DDL in a new document
- **Copy DDL**: Copy DDL to clipboard

### Quick Queries

Right-click on a table:
- **SELECT TOP 100**: Generate `SELECT * FROM table LIMIT 100` query
- **Copy Table Name**: Copy schema.tablename

---

## Query Results

### Results Panel

Results are displayed in the bottom panel after query execution:

- **Connection info**: Shows which connection was used
- **Row count**: Number of rows returned
- **Execution time**: Query execution time (ms)

### Pagination

For large result sets (more than 100 rows), pagination is enabled:

- Navigate with **First**, **Previous**, **Next**, **Last** buttons
- Jump to specific page by entering page number
- Change page size (100, 500, 1000, 5000 rows per page)
- Shows current row range (e.g., "1-500 of 90000 rows")
- Efficiently handles very large result sets (90,000+ rows)

### Export Data

- **CSV**: Export as CSV file
- **JSON**: Export as JSON file
- **Copy**: Copy as tab-separated text

### Row Selection

- Select with checkbox on each row
- Multiple rows can be selected

### View as JSON

1. Select desired rows with checkboxes
2. Click **View JSON** button
3. Displayed in JSON format in a new document
   - Single selection: Single object
   - Multiple selections: Array

---

## Data Editing

### Enable Edit Mode

1. Click **Enable Editing** in the results panel after query execution
2. Specify table name and Primary Key column
3. Or use auto-detected settings (id, *_id columns)

### Cell Editing

1. **Double-click** a cell to enter edit mode
2. After entering value:
   - **Enter**: Save
   - **Tab**: Move to next cell
   - **Escape**: Cancel
3. Modified cells are highlighted in green

### Enter NULL Value

- **NULL** button appears when editing a cell
- Click to set value to NULL
- Empty string ('') and NULL are distinguished

### Add Row

1. Click **+ Add Row** button
2. New row is added at the bottom of the table (green background)
3. Enter values in each cell

### Delete Row

1. Select the row's checkbox to delete
2. Click **Delete Selected** button
3. Rows marked for deletion are shown with strikethrough

### Save Changes

1. Click **Save Changes** button
2. All changes are applied to the database
3. Executed SQL is recorded in query history

### Discard Changes

- **Discard** button: Cancel all changes

---

## Session Management

View and manage active database sessions.

### Open Sessions Panel

1. Click the sessions button in the editor title bar (when SQL file is open)
2. Or use Command Palette: `PostgreSQL: Show Active Sessions`
3. If multiple connections exist, select which connection to view

### Sessions Panel Features

- **Session List**: Shows all active sessions with PID, database, user, application, client, state, duration, and query
- **Status Badges**: Total sessions, Active, Idle, Idle in Transaction counts
- **Auto-refresh**: Enable auto-refresh with 5s, 10s, 30s, or 60s intervals

### Session Actions

- **Cancel Query**: Cancel the running query on a session (uses `pg_cancel_backend()`)
  - Only available for sessions in "active" state
- **Kill Session**: Terminate a session forcefully (uses `pg_terminate_backend()`)
  - Use with caution - forcefully closes the connection
- **Copy Query**: Copy the currently running query to clipboard

### Session States

| State | Description |
|-------|-------------|
| active | Currently executing a query |
| idle | Connected but not executing |
| idle in transaction | In a transaction block, waiting for commands |

---

## Query History

### View History

Check in the **Query History** section of the PostgreSQL explorer

### Displayed Information

- SQL statement (beginning portion)
- Execution time
- Row count
- Error status

### Use History

- Click item: Open the SQL in a new document
- Connection info is also displayed

### Delete History

- Right-click on History section → **Clear History**

---

## Keyboard Shortcuts

| Function | Mac | Windows/Linux |
|----------|-----|---------------|
| Execute Query | `Cmd+Enter` | `Ctrl+Enter` |
| New File | `Cmd+N` | `Ctrl+N` |
| Command Palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |

---

## Settings

Search for `pgsql` in VS Code settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `pgsql.maxRows` | Maximum rows to fetch | 1000 |
| `pgsql.queryTimeout` | Query timeout (ms) | 30000 |

---

## Troubleshooting

### Connection Failed

1. Check host/port
2. Check username/password
3. Check database name
4. Verify PostgreSQL server is running
5. Check firewall settings

### SSL Connection Error

- Check **Use SSL** in connection settings
- Or add `?sslmode=require` to connection string

### Query Timeout

- Increase `pgsql.queryTimeout` value in settings

---

## Support

Report issues: [GitHub Issues](https://github.com/steve/lightweight-pgsql-client/issues)
