FROM python:3.12-slim

WORKDIR /app

# ── System dependencies ───────────────────────────────────────────────────────
# clamav + clamav-daemon: virus scanner binaries + clamd service
# Virus DEFINITIONS are NOT downloaded here — freshclam runs at container startup
# so definitions are always current (ClamAV updates several times per day).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl dos2unix \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    clamav clamav-daemon \
    && rm -rf /var/lib/apt/lists/*

# Prepare ClamAV directories and write a minimal clamd.conf
# (the default Debian package conf uses OnAccessScanning which requires inotify — disable it)
RUN mkdir -p /var/run/clamav /var/lib/clamav && \
    chown -R clamav:clamav /var/run/clamav /var/lib/clamav && \
    # Strip the example config down to the essentials
    echo "LocalSocket /var/run/clamav/clamd.ctl" > /etc/clamav/clamd.conf && \
    echo "LocalSocketMode 666"                  >> /etc/clamav/clamd.conf && \
    echo "User clamav"                          >> /etc/clamav/clamd.conf && \
    echo "DatabaseDirectory /var/lib/clamav"    >> /etc/clamav/clamd.conf && \
    echo "LogSyslog false"                      >> /etc/clamav/clamd.conf && \
    echo "LogFile /var/log/clamav/clamav.log"   >> /etc/clamav/clamd.conf && \
    echo "LogTime true"                         >> /etc/clamav/clamd.conf && \
    echo "MaxDirectoryRecursion 15"             >> /etc/clamav/clamd.conf && \
    echo "FollowDirectorySymlinks false"        >> /etc/clamav/clamd.conf && \
    echo "FollowFileSymlinks false"             >> /etc/clamav/clamd.conf && \
    echo "ReadTimeout 180"                      >> /etc/clamav/clamd.conf && \
    echo "MaxThreads 4"                         >> /etc/clamav/clamd.conf && \
    echo "MaxConnectionQueueLength 30"          >> /etc/clamav/clamd.conf && \
    echo "StreamMaxLength 100M"                 >> /etc/clamav/clamd.conf && \
    mkdir -p /var/log/clamav && chown clamav:clamav /var/log/clamav

# ── Python dependencies ───────────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ──────────────────────────────────────────────────────────
COPY app/ ./app/
COPY entrypoint.sh /entrypoint.sh
RUN dos2unix /entrypoint.sh && chmod +x /entrypoint.sh

# Trainer plugins — shipped with the image.
# /app/trainers/         → runtime volume (user edits live here)
# /app/trainers_builtin/ → read-only seed; entrypoint.sh copies missing
#                          sample_*.py files into the volume on every startup
COPY trainers/ /app/trainers/
COPY trainers/ /app/trainers_builtin/

EXPOSE 8030

# entrypoint.sh starts freshclam (background) + clamd, then execs the CMD
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8030"]
