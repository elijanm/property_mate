FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install uv

# copy build metadata first (cache-friendly)
COPY pyproject.toml ./
# optional but sometimes needed
COPY README* ./
COPY app/ app/

# editable install now works because source exists
RUN uv pip install --system --no-cache -e ".[dev]"

# copy the rest (tests, scripts, etc.)
COPY . .

CMD ["python", "-m", "app.main"]