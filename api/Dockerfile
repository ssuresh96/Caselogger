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
#
# --proxy-headers --forwarded-allow-ips='*' (security audit H-2): Render
# terminates TLS and reverse-proxies to this container, so without this,
# request.client.host — what the login rate limiter keys on — is the
# proxy's own hop, not the real client IP, collapsing everyone into one
# shared rate-limit bucket. '*' trusts the immediate hop's X-Forwarded-For,
# which is fine here since Render's proxy is the only thing that can reach
# this container directly (no public inbound path around it).
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'
