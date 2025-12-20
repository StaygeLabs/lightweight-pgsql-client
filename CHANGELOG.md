# Changelog

All notable changes to the "Lightweight PostgreSQL Client" extension will be documented in this file.

## [0.1.2] - 2024-12-20

### Added
- Session management panel - view active database sessions, cancel queries, and terminate sessions
- Cancel button in editor title bar - shows only when a query is running
- Pagination for large result sets - efficiently handles 90,000+ rows with page navigation

### Changed
- "View All" button replaced with "View More" - loads next 100 rows incrementally instead of loading all at once
- Improved performance for large result sets by rendering only the current page

## [0.1.1] - 2024-12-20

### Added
- Query cancellation support - cancel long-running queries via Cancel button or `PostgreSQL: Cancel Query` command

## [0.1.0] - 2024-12-20

### Added
- Connection management with secure password storage
- SQL query execution with document-specific connections
- Auto-limit SELECT queries to 100 rows with "View All" option
- Confirmation dialog for data modification queries
- Schema explorer (schemas, tables, views, columns)
- Table info panel with DDL view
- Query results with inline editing support
- NULL value input via button
- Add/delete rows in results
- Export to CSV and JSON
- View selected rows as JSON
- Query history tracking
- SQL auto-completion for tables and columns
- SQL formatting
- Hover information for tables
