# Sirius Transport

Веб-приложение для анализа телеметрии трамвая.

Проект читает поток JSON-объектов, находит события торможения, ADAS,
локализации, FSM и сервисов, показывает их на таймлайне и позволяет
воспроизвести движение трамвая на карте.

## Запуск

Backend:

```powershell
python -m uvicorn backend.app.main:app --reload
```

Frontend:

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```

Открыть приложение: http://127.0.0.1:5173/

Swagger API: http://127.0.0.1:8000/docs