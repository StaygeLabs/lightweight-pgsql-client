# Quick Start Guide

## 1. Add Connection

1. Click the PostgreSQL icon in the sidebar
2. Click the **+** button
3. Enter connection details or paste a connection string

```
postgresql://user:password@localhost:5432/database
```

## 2. Connect

- Click the plug icon on the connection item in the Connections list
- Or right-click → **Connect**

## 3. Execute Query

1. Open a SQL file or create a new query
2. Write SQL:
   ```sql
   SELECT * FROM users WHERE active = true;
   ```
3. `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows)

## 4. View Results

- View results in the bottom panel
- Export to CSV/JSON available
- Select rows and click **View JSON** to see JSON format

## 5. Edit Data

1. Click **Enable Editing**
2. Specify table name and PK column
3. Double-click a cell to edit
4. Click **Save Changes** to save

## Keyboard Shortcuts

| Function | Mac | Windows |
|----------|-----|---------|
| Execute Query | `Cmd+Enter` | `Ctrl+Enter` |

## Tips

- SELECT without LIMIT automatically limits to 100 rows
- Data modification queries show a confirmation popup
- To enter NULL: Click the **NULL** button when editing a cell
