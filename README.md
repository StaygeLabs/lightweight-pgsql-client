# Lightweight PostgreSQL Client

A lightweight and fast PostgreSQL client extension for Visual Studio Code.

## Why Lightweight PostgreSQL Client?

**Built for developers and operators who work with SQL every day.** This extension focuses on essential features without unnecessary complexity.

### Privacy & Security First

- **Direct connection only** — Connects directly from your machine to your database. No third-party servers, no proxies, no middlemen.
- **Your data stays yours** — Zero data collection, zero telemetry, zero external API calls. Your queries and data never leave your local environment.
- **Secure credential storage** — Passwords are stored in VS Code's built-in Secret Storage, not in plain text config files.

## Features

### Connection Management
- Save multiple database connections
- Secure password storage using VS Code's Secret Storage
- Connect/disconnect from the sidebar
- Quick connect via connection string

### Query Execution
- Execute SQL queries with `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows/Linux)
- Document-specific connection binding
- Auto-limit SELECT queries to 100 rows (with "View All" option)
- SQL comment stripping before execution
- Confirmation dialog for data modification queries (INSERT, UPDATE, DELETE, etc.)

### Schema Explorer
- Browse schemas, tables, and views
- View table structure, indexes, foreign keys, and constraints
- View table DDL
- Copy table names
- Quick "SELECT TOP 100" query generation

### Query Results
- View results in a data grid
- Export to CSV or JSON
- View selected rows as JSON
- Edit data inline (with NULL button support)
- Add/delete rows
- Save changes back to database

### Query History
- Track executed queries
- Re-open queries from history

### SQL Language Features
- Auto-completion for tables and columns
- Hover information for tables
- SQL formatting

## Documentation

- **Quick Start**: [English](docs/quick-start.en.md) | [한국어](docs/quick-start.ko.md)
- **User Manual**: [English](docs/user-manual.en.md) | [한국어](docs/user-manual.ko.md)

## Usage

1. Open the PostgreSQL sidebar (database icon in Activity Bar)
2. Click "+" to add a new connection
3. Enter connection details or paste a connection string
4. Connect to the database
5. Open a `.sql` file or create a new query
6. Execute with `Cmd+Enter` / `Ctrl+Enter`

## Keyboard Shortcuts

| Command | Mac | Windows/Linux |
|---------|-----|---------------|
| Execute Query | `Cmd+Enter` | `Ctrl+Enter` |

## Requirements

- VS Code 1.85.0 or higher
- PostgreSQL database

## Extension Settings

- `pgsql.maxRows`: Maximum number of rows to fetch (default: 1000)
- `pgsql.queryTimeout`: Query timeout in milliseconds (default: 30000)

## Known Issues

See [GitHub Issues](https://github.com/steve/lightweight-pgsql-client/issues)

## Release Notes

### 0.1.0

Initial release:
- Connection management with secure password storage
- SQL query execution with document-specific connections
- Schema explorer with table info view
- Query results with inline editing
- Export to CSV/JSON
- Query history
- SQL auto-completion and formatting

## License

MIT
