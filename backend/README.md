# Backend

Run from the repository root:

```powershell
uvicorn backend.app.main:app --reload
```

The API currently uses an in-memory index and stores uploaded files in `uploads/`.
PostgreSQL and Alembic are intentionally deferred until the API contract is stable.