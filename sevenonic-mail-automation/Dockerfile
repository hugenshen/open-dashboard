FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir ".[postgres]"

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data /artifacts \
    && chown -R appuser:appuser /data /artifacts /app
USER appuser

EXPOSE 8091
CMD ["sevenonic-mail", "serve", "--port", "8091"]
