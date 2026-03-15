# Making MinIO Publicly Accessible for RunPod Cloud Training

When a training job runs on a RunPod pod, the pod is a remote container on the
internet. It needs to upload the trained model and metrics back to MinIO (the
project's S3-compatible store). By default, MinIO is only reachable at
`http://localhost:9000` — unreachable from any external host.

This guide covers three approaches from simplest to most production-ready.

---

## Why This Matters

The ML service sets `S3_ENDPOINT` inside every RunPod pod to the value of
`S3_PUBLIC_ENDPOINT_URL`. If that URL is `http://localhost:9000`, the pod tries
to connect to itself and gets `Connection refused`.

The service has a built-in fallback: models ≤ 4 MB compressed are emitted as
base64 in pod stdout and recovered automatically. This covers most small/medium
sklearn models. For larger models (YOLOv8 weights, transformer fine-tunes, etc.)
you need a real public endpoint.

---

## Option A — Expose Local MinIO via ngrok (dev / testing)

Best for: laptop development, quick tests, no infrastructure changes required.

### 1. Install ngrok

```bash
# macOS
brew install ngrok/ngrok/ngrok

# Linux
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
```

Sign up at ngrok.com and authenticate:
```bash
ngrok config add-authtoken <your-token>
```

### 2. Start the tunnel

MinIO listens on port 9000. Run this in a separate terminal:

```bash
ngrok http 9000
```

ngrok prints something like:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:9000
```

### 3. Update `apps/ml/.env`

```env
S3_PUBLIC_ENDPOINT_URL=https://abc123.ngrok-free.app
```

Then restart the ML service:
```bash
docker compose -f infra/docker/docker-compose.yml restart pms-ml
```

### Caveats

- The ngrok URL changes on every restart (free plan). Update `.env` each time.
- Free plan has a request limit (~40 req/min). Sufficient for model uploads.
- ngrok adds ~50–100 ms latency to uploads, which is fine for occasional training.
- A paid ngrok plan gives a stable subdomain: `ngrok http --domain=minio.yourdomain.com 9000`

---

## Option B — Expose MinIO on a VPS / Public IP (staging / shared dev)

Best for: a cloud VM running docker-compose, always-on shared dev environment.

### 1. Open port 9000 in your firewall

**AWS EC2 / Lightsail**: add inbound rule TCP 9000 in Security Group.

**DigitalOcean / Hetzner**: add firewall rule allowing TCP 9000 from `0.0.0.0/0`.

**Linux `ufw`**:
```bash
sudo ufw allow 9000/tcp
```

### 2. Verify MinIO is bound to all interfaces

In `infra/docker/docker-compose.yml` the MinIO service already binds to the host:
```yaml
ports:
  - "9000:9000"
  - "9001:9001"
```
This is sufficient — Docker maps `0.0.0.0:9000` by default.

### 3. Update `apps/ml/.env`

```env
S3_PUBLIC_ENDPOINT_URL=http://<your-server-public-ip>:9000
```

### 4. (Recommended) Enable MinIO TLS for public exposure

For a production-shared dev server, add TLS. The simplest way is to put Nginx
in front of MinIO as a reverse proxy with a Let's Encrypt certificate:

```nginx
# /etc/nginx/sites-available/minio
server {
    listen 443 ssl;
    server_name minio.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/minio.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/minio.yourdomain.com/privkey.pem;

    # Increase body size for model uploads (default 1m is too small)
    client_max_body_size 500m;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Required by MinIO path-style requests
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Obtain the certificate:
```bash
sudo certbot --nginx -d minio.yourdomain.com
```

Then update `.env`:
```env
S3_PUBLIC_ENDPOINT_URL=https://minio.yourdomain.com
```

---

## Option C — Use AWS S3 or Cloudflare R2 (production)

Best for: production workloads, large models, no self-managed infrastructure.

### AWS S3

1. Create a bucket (`pms-ml`) in the AWS Console or via CLI:
   ```bash
   aws s3 mb s3://pms-ml --region us-east-1
   ```

2. Create an IAM user with `AmazonS3FullAccess` (or a scoped policy), download
   the access key/secret.

3. Update `apps/ml/.env`:
   ```env
   # Leave S3_ENDPOINT_URL blank — boto3/aioboto3 defaults to AWS S3
   S3_ENDPOINT_URL=
   S3_PUBLIC_ENDPOINT_URL=
   S3_ACCESS_KEY=AKIA...
   S3_SECRET_KEY=...
   S3_BUCKET=pms-ml
   S3_REGION=us-east-1
   ```

4. Update `infra/docker/docker-compose.yml` for the `pms-ml` and `pms-ml-worker`
   services:
   ```yaml
   environment:
     S3_ENDPOINT_URL: ""
     S3_PUBLIC_ENDPOINT_URL: ""
     S3_ACCESS_KEY: ${ML_S3_ACCESS_KEY}
     S3_SECRET_KEY: ${ML_S3_SECRET_KEY}
     S3_BUCKET: pms-ml
     S3_REGION: us-east-1
   ```

   > MLflow also needs updated env vars. Change `MLFLOW_S3_ENDPOINT_URL` to empty
   > and update `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` accordingly.

### Cloudflare R2 (S3-compatible, no egress fees)

1. Create a bucket in the Cloudflare dashboard → R2 → Create bucket → `pms-ml`.

2. Create an API token with Object Read & Write permission.

3. Find your R2 endpoint: `https://<account-id>.r2.cloudflarestorage.com`

4. Update `apps/ml/.env`:
   ```env
   S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
   S3_PUBLIC_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
   S3_ACCESS_KEY=<r2-access-key-id>
   S3_SECRET_KEY=<r2-secret-access-key>
   S3_BUCKET=pms-ml
   S3_REGION=auto
   ```

   R2 accepts standard AWS S3 SDK requests — no other code changes needed.

---

## Verifying the Configuration

After changing `S3_PUBLIC_ENDPOINT_URL`, run a quick connectivity check from
outside your network (or simulate it locally with curl):

```bash
# Replace with your actual public URL
curl -I http://<public-endpoint>/minio/health/live
# Expected: HTTP/1.1 200 OK
```

Then trigger a cloud GPU training job and watch the pod logs in the Jobs UI.
You should see:
```
[bootstrap] uploading to s3://pms-ml/...
[bootstrap] upload_done (42.3s)
{"upload_ok": true}
```

If you still see `S3 upload failed` but `upload_ok` is false, the inline fallback
activates automatically for models ≤ 4 MB — the job still succeeds and the model
is registered in MLflow.

---

## `S3_ENDPOINT_URL` vs `S3_PUBLIC_ENDPOINT_URL` — What Each Is For

| Variable | Used by | Value |
|---|---|---|
| `S3_ENDPOINT_URL` | ML service container → MinIO | `http://minio:9000` (Docker internal hostname) |
| `S3_PUBLIC_ENDPOINT_URL` | RunPod pods (external internet) | Public IP / ngrok / R2 / AWS |

The ML service always uses `S3_ENDPOINT_URL` for its own uploads (presigned URL
generation, artifact downloads). RunPod pods receive `S3_PUBLIC_ENDPOINT_URL` as
their `S3_ENDPOINT` env var. Keep both set correctly — they serve different
network contexts.

---

## Security Notes

- **Never** expose MinIO with default credentials (`minioadmin`/`minioadmin`) on
  a public IP. Rotate credentials before opening port 9000:
  ```bash
  # Update docker-compose.yml:
  MINIO_ROOT_USER: pms-ml-admin
  MINIO_ROOT_PASSWORD: <strong-random-password>
  # Update S3_ACCESS_KEY / S3_SECRET_KEY in .env to match
  ```

- For IP-restricted environments (VPS where only your CI and RunPod IPs are
  known), use MinIO's built-in policy to restrict access to specific buckets
  rather than opening the root credentials publicly.

- RunPod pods receive credentials via environment variables. These are visible
  in the RunPod dashboard under pod environment. Use a dedicated IAM user / R2
  token with write-only access to the `pms-ml` bucket — not the root admin key.
