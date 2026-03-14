FROM python:3.12-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install uv

FROM base AS deps
COPY pyproject.toml ./
# (optional but often needed for build metadata)
COPY README* ./
# copy only the package(s) needed to build/install
COPY app/ app/
# if you have src-layout, use: COPY src/ src/

RUN uv pip install --system --no-cache -e ".[dev]"

FROM deps AS final
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]