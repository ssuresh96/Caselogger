FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
# Shell form (for $PORT expansion — exec-form JSON arrays can't do that),
# but `exec` replaces the shell with uvicorn as PID 1 so it still receives
# SIGTERM directly from the platform on deploy/restart instead of a
# wrapper shell swallowing it.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
