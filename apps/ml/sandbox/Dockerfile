FROM python:3.12-slim

# Install common ML dependencies only — NO app source code, NO infra credentials
RUN pip install --no-cache-dir \
    cloudpickle \
    numpy \
    pandas \
    scikit-learn \
    scipy \
    psutil \
    "redis[asyncio]>=5.0" \
    && pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu \
    || pip install --no-cache-dir torch  \
    && true

# Non-root user for execution
RUN useradd -u 65534 -s /bin/false -M nobody_ml || true

WORKDIR /runner

COPY runner.py /runner/runner.py
COPY agent.py  /runner/agent.py

# Sandbox workspace will be mounted at /sandbox_workspace
RUN mkdir -p /sandbox_workspace && chmod 777 /sandbox_workspace

USER 65534

# Default entrypoint: one-shot runner (TRAINER_SANDBOX=docker)
# Pool agent uses: --entrypoint python /runner/agent.py  (TRAINER_SANDBOX=docker-pool)
ENTRYPOINT ["python", "/runner/runner.py"]
