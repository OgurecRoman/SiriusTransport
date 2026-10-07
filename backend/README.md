# Backend

Run from the repository root:

```powershell
uvicorn backend.app.main:app --reload
```

The API stores users, projects, uploaded files, readings and events in SQLAlchemy.
By default it uses `telemetry.db` (SQLite). For PostgreSQL set `DATABASE_URL`, for example:

```powershell
$env:DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/tram"
```

Uploaded source files remain in `uploads/`; projects are persistent folders in the database.