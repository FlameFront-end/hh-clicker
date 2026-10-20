FROM node:22-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

# tzdata нужен для ZoneInfo("Europe/Moscow") — без него _today_msk() silent-fall к UTC,
# daily reset для apply-counter сдвигается на 3h (kimi-r14-4 #8).
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

COPY server/web_app.py server/web_app.py
COPY server/app/ server/app/
COPY server/scripts/ server/scripts/
COPY client/static/ client/static/
COPY --from=client-build /build/client/static/dist client/static/dist/
ENV PYTHONPATH=/app/server

# Папка data монтируется через volume (см. docker-compose.yml)
RUN mkdir -p data

EXPOSE 8000

CMD ["python", "server/web_app.py"]
