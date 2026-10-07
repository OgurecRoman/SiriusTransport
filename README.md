# Sirius Transport

Sirius Transport — веб-приложение для разбора трамвайной телеметрии. Оно читает
JSONSEQ и CSV, находит важные моменты поездки, показывает их на таймлайне и
помогает посмотреть движение на карте.

## Быстрый запуск через Docker

Нужен Docker Desktop с Compose:

```powershell
docker compose up --build
```

Открыть приложение: http://127.0.0.1:5173/

API и Swagger: http://127.0.0.1:8000/docs

Остановить контейнеры:

```powershell
docker compose down
```

Данные PostgreSQL и загруженные файлы сохраняются в Docker volumes.

## Запуск без Docker

Backend:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.app.main:app --reload
```

Frontend в отдельном терминале:

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```

В локальном режиме используется SQLite-файл `telemetry.db`, а загруженные
файлы лежат в `uploads/`.

## Что внутри

- `parser/` — потоковый разбор JSONSEQ и CSV;
- `detectors/` — события торможения, ADAS, локализации, FSM и сервисов;
- `backend/` — FastAPI, SQLAlchemy, аккаунты, проекты и статистика;
- `frontend/` — React, TypeScript, Vite, таймлайн и карта.