import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Copy, CheckCircle2, ChevronDown, ChevronRight, Key, Play, Loader2, Lock, X } from 'lucide-react'
import clsx from 'clsx'
import PageFooter from '@/components/PageFooter'
import Logo from '@/components/Logo'

const BASE_URL = 'https://api.mldock.io'

interface Props {
  onBack: () => void
  onSignIn: () => void
  onGettingStarted: () => void
  onPrivacy?: () => void
  onTerms?: () => void
  initialSection?: string
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface Endpoint {
  method: Method
  path: string
  summary: string
  description: string
  auth: boolean
  body?: string
  response: string
  params?: string
  curlExample: string
  pythonExample: string
  liveMethod?: string    // fetch method override for live test
  liveBody?: object      // default body for live test
  livePath?: string      // path with example values substituted
}

const METHOD_COLOR: Record<Method, string> = {
  GET:    'bg-blue-900/50 text-blue-300 border-blue-800/50',
  POST:   'bg-emerald-900/50 text-emerald-300 border-emerald-800/50',
  PATCH:  'bg-amber-900/50 text-amber-300 border-amber-800/50',
  DELETE: 'bg-red-900/50 text-red-300 border-red-800/50',
}

const SECTIONS: { title: string; description: string; endpoints: Endpoint[] }[] = [
  {
    title: 'Authentication',
    description: 'Obtain a JWT token by logging in. Pass it as a Bearer token in every subsequent request header. API keys (preferred for production) are created through the API Keys section below.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/auth/login',
        summary: 'Sign in and receive a JWT token',
        description: 'Exchange your email and password for a short-lived JWT. The token expires after a set period — use it directly in Authorization headers or exchange it for a permanent API key via the dashboard. Roles: any registered user.',
        auth: false,
        body: `{
  "email": "user@example.com",
  "password": "your-password"
}`,
        response: `{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "user_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "org_id":  "org_abc123",
    "email":   "user@example.com",
    "role":    "engineer"
  }
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "user@example.com",
    "password": "your-password"
  }'`,
        pythonExample: `import requests

resp = requests.post("${BASE_URL}/api/v1/auth/login", json={
    "email": "user@example.com",
    "password": "your-password",
})
token = resp.json()["token"]
print(token)`,
        livePath: '/api/v1/auth/login',
        liveBody: { email: 'user@example.com', password: 'your-password' },
      },
      {
        method: 'POST',
        path: '/api/v1/auth/logout',
        summary: 'Revoke session and invalidate refresh token',
        description: 'Invalidates the current session. The refresh token is removed from Redis and the session key is deleted. Call this on sign-out.',
        auth: true,
        response: '{ "ok": true }',
        curlExample: `curl -X POST ${BASE_URL}/api/v1/auth/logout \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

requests.post("${BASE_URL}/api/v1/auth/logout",
    headers={"Authorization": "Bearer YOUR_API_KEY"})`,
        livePath: '/api/v1/auth/logout',
      },
      {
        method: 'POST',
        path: '/api/v1/auth/forgot-password',
        summary: 'Request a password reset link',
        description: 'Sends a password reset email to the given address. Always returns ok regardless of whether the email is registered — this prevents user enumeration. The reset link is valid for 1 hour.',
        auth: false,
        body: `{
  "email": "user@example.com"
}`,
        response: `{ "ok": true }`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/auth/forgot-password \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "user@example.com" }'`,
        pythonExample: `import requests

resp = requests.post("${BASE_URL}/api/v1/auth/forgot-password",
    json={"email": "user@example.com"})
print(resp.json())  # {"ok": true}`,
        liveBody: { email: 'user@example.com' },
        livePath: '/api/v1/auth/forgot-password',
      },
      {
        method: 'POST',
        path: '/api/v1/auth/reset-password',
        summary: 'Set a new password using reset token',
        description: 'Completes the password reset flow. Supply the token from the email link and the desired new password (minimum 8 characters). The token is single-use and expires after 1 hour.',
        auth: false,
        body: `{
  "token":        "uuid-from-reset-link",
  "new_password": "MyNewPass123!"
}`,
        response: `{ "ok": true }`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/auth/reset-password \\
  -H "Content-Type: application/json" \\
  -d '{
    "token":        "uuid-from-reset-link",
    "new_password": "MyNewPass123!"
  }'`,
        pythonExample: `import requests

resp = requests.post("${BASE_URL}/api/v1/auth/reset-password",
    json={
        "token": "uuid-from-reset-link",
        "new_password": "MyNewPass123!",
    })
print(resp.json())  # {"ok": true}`,
        liveBody: { token: 'RESET_TOKEN', new_password: 'NewPassword123!' },
        livePath: '/api/v1/auth/reset-password',
      },
      {
        method: 'POST',
        path: '/api/v1/auth/change-password',
        summary: 'Change password for the authenticated user',
        description: 'Changes the password for the currently signed-in user. Requires the current password for verification. Minimum 8 characters for the new password. Use this from account settings rather than the public reset flow.',
        auth: true,
        body: `{
  "current_password": "OldPass123!",
  "new_password":     "NewPass456!"
}`,
        response: `{ "ok": true }`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/auth/change-password \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "current_password": "OldPass123!",
    "new_password":     "NewPass456!"
  }'`,
        pythonExample: `import requests

resp = requests.post("${BASE_URL}/api/v1/auth/change-password",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "current_password": "OldPass123!",
        "new_password": "NewPass456!",
    })
print(resp.json())  # {"ok": true}`,
        liveBody: { current_password: 'CurrentPass123!', new_password: 'NewPassword456!' },
        livePath: '/api/v1/auth/change-password',
      },
    ],
  },
  {
    title: 'Training',
    description: 'Start, monitor, and cancel training jobs. Jobs can run on your local machine (free tier — 10 hrs/month) or on cloud GPUs billed per-second from your wallet. The same trainer plugin code runs on both.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/training/gpu-options',
        summary: 'List available GPUs with live prices',
        description: 'Returns all GPU types currently available, along with real-time pricing in USD per hour. Use the `id` field from this response as `gpu_type_id` when starting a job. Prices may vary based on current availability.',
        auth: true,
        response: `{
  "available": true,
  "source": "live",
  "options": [
    {
      "id":             "NVIDIA GeForce RTX 3090",
      "name":           "RTX 3090",
      "vram_gb":        24,
      "price_per_hour": 0.476,
      "currency":       "USD",
      "tier":           "budget",
      "recommended":    true,
      "available":      true
    },
    {
      "id":             "NVIDIA A100",
      "name":           "A100 80GB",
      "vram_gb":        80,
      "price_per_hour": 1.89,
      "currency":       "USD",
      "tier":           "performance",
      "recommended":    false,
      "available":      true
    }
  ]
}`,
        curlExample: `curl ${BASE_URL}/api/v1/training/gpu-options \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get("${BASE_URL}/api/v1/training/gpu-options",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
for gpu in resp.json()["options"]:
    print(gpu["name"], "$" + str(gpu["price_per_hour"]) + "/hr")`,
        livePath: '/api/v1/training/gpu-options',
      },
      {
        method: 'POST',
        path: '/api/v1/training/start',
        summary: 'Start a training job (local or cloud GPU)',
        description: 'Queues a training job for the specified trainer plugin. Set `compute_type` to `"local"` to run on the MLDock server (uses your free monthly quota) or `"cloud_gpu"` to provision a GPU. For cloud jobs, the estimated cost is reserved from your wallet upfront — any unused amount is refunded when the job finishes. You can override trainer config values without editing the plugin file.',
        auth: true,
        body: `{
  "trainer_name":     "my-classifier",
  "compute_type":     "cloud_gpu",
  "gpu_type_id":      "NVIDIA GeForce RTX 3090",
  "config_overrides": {
    "max_epochs": 50,
    "batch_size": 32
  }
}`,
        response: `{ "job_id": "64f1a2b3c4d5e6f7a8b9c0d1" }`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/training/start \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "trainer_name": "my-classifier",
    "compute_type": "cloud_gpu",
    "gpu_type_id":  "NVIDIA GeForce RTX 3090",
    "config_overrides": { "max_epochs": 50 }
  }'`,
        pythonExample: `import requests

resp = requests.post("${BASE_URL}/api/v1/training/start",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "trainer_name": "my-classifier",
        "compute_type": "cloud_gpu",
        "gpu_type_id":  "NVIDIA GeForce RTX 3090",
        "config_overrides": {"max_epochs": 50},
    })
job_id = resp.json()["job_id"]
print("Job started:", job_id)`,
        livePath: '/api/v1/training/start',
        liveBody: { trainer_name: 'my-classifier', compute_type: 'local' },
      },
      {
        method: 'GET',
        path: '/api/v1/training/jobs',
        summary: 'List all training jobs',
        description: 'Returns a paginated list of all training jobs in your account, ordered by most recent first. Filter by trainer name to see jobs for a specific model. Each job includes status (`queued`, `running`, `completed`, `failed`), runtime, GPU cost charged, and final evaluation metrics.',
        auth: true,
        params: 'trainer_name (optional), page (default 1), page_size (default 20)',
        response: `{
  "items": [
    {
      "id":             "64f1a2b3c4d5e6f7a8b9c0d1",
      "trainer_name":   "my-classifier",
      "status":         "completed",
      "compute_type":   "cloud_gpu",
      "gpu_type_id":    "NVIDIA GeForce RTX 3090",
      "started_at":     "2026-03-13T10:00:00Z",
      "finished_at":    "2026-03-13T10:12:30Z",
      "wallet_charged": 0.09,
      "metrics":        { "accuracy": 0.947, "f1": 0.941 }
    }
  ],
  "total": 1
}`,
        curlExample: `curl "${BASE_URL}/api/v1/training/jobs?page=1&page_size=20" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get("${BASE_URL}/api/v1/training/jobs",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    params={"page": 1, "page_size": 20})
for job in resp.json()["items"]:
    print(job["trainer_name"], job["status"])`,
        livePath: '/api/v1/training/jobs',
      },
      {
        method: 'POST',
        path: '/api/v1/training/jobs/:id/cancel',
        summary: 'Cancel a running or queued job',
        description: 'Immediately cancels the job and stops any cloud GPU provisioning. If a GPU was already provisioned, billing stops within seconds and unused reserved cost is returned to your wallet.',
        auth: true,
        response: `{ "ok": true }`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/training/jobs/JOB_ID/cancel \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

job_id = "64f1a2b3c4d5e6f7a8b9c0d1"
resp = requests.post(
    f"${BASE_URL}/api/v1/training/jobs/{job_id}/cancel",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
print(resp.json())`,
        livePath: '/api/v1/training/jobs',  // list only — cancel needs real id
      },
    ],
  },
  {
    title: 'Inference',
    description: 'Call your deployed models as REST APIs. Every trainer you train becomes a live endpoint the moment the job completes. No deployment step required — just POST your inputs and get predictions back.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/inference/:trainer_name/predict',
        summary: 'Run inference against the deployed model',
        description: 'Sends input data to the currently deployed model for a trainer and returns predictions. The request body shape depends on the trainer\'s `input_schema` — use the `/schema` endpoint below to discover it. The response shape depends on your trainer\'s `predict()` return value. All calls are logged and available for review in the inference logs dashboard.',
        auth: true,
        body: `{
  "sepal_length": 5.1,
  "sepal_width":  3.5,
  "petal_length": 1.4,
  "petal_width":  0.2
}`,
        response: `{
  "species":    "setosa",
  "confidence": 0.98,
  "latency_ms": 12
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/inference/my-classifier/predict \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sepal_length": 5.1,
    "sepal_width":  3.5,
    "petal_length": 1.4,
    "petal_width":  0.2
  }'`,
        pythonExample: `import requests

resp = requests.post(
    "${BASE_URL}/api/v1/inference/my-classifier/predict",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "sepal_length": 5.1,
        "sepal_width":  3.5,
        "petal_length": 1.4,
        "petal_width":  0.2,
    })
print(resp.json())
# {"species": "setosa", "confidence": 0.98, "latency_ms": 12}`,
        livePath: '/api/v1/inference/my-classifier/predict',
        liveBody: { sepal_length: 5.1, sepal_width: 3.5, petal_length: 1.4, petal_width: 0.2 },
      },
      {
        method: 'GET',
        path: '/api/v1/inference/:trainer_name/schema',
        summary: 'Get input/output schema for a trainer',
        description: 'Returns the expected input fields and output fields for a trainer\'s prediction endpoint. Use this to auto-generate forms or validate inputs before sending. Field types are `number`, `text`, `boolean`, or `image`.',
        auth: true,
        response: `{
  "trainer_name": "my-classifier",
  "input_schema": {
    "sepal_length": { "type": "number", "label": "Sepal length (cm)", "required": true },
    "sepal_width":  { "type": "number", "label": "Sepal width (cm)",  "required": true },
    "petal_length": { "type": "number", "label": "Petal length (cm)", "required": true },
    "petal_width":  { "type": "number", "label": "Petal width (cm)",  "required": true }
  },
  "output_schema": {
    "species":    { "type": "text",   "label": "Predicted species" },
    "confidence": { "type": "number", "label": "Confidence score" }
  }
}`,
        curlExample: `curl ${BASE_URL}/api/v1/inference/my-classifier/schema \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get(
    "${BASE_URL}/api/v1/inference/my-classifier/schema",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
schema = resp.json()
print("Inputs:", list(schema["input_schema"].keys()))`,
        livePath: '/api/v1/inference/my-classifier/schema',
      },
    ],
  },
  {
    title: 'Models',
    description: 'Manage deployed model versions. Each completed training job produces a versioned model. You can list all versions for a trainer, compare metrics between them, and remove old versions.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/models',
        summary: 'List all deployed model versions',
        description: 'Returns all model deployment records. Filter by `trainer_name` to see versions for a specific trainer. Set `include_all=true` to include non-default versions (by default only the active/default version per trainer is returned). Metrics like accuracy, F1, loss, etc. are populated from the training run that produced the model.',
        auth: true,
        params: 'trainer_name (optional), include_all (bool, default false)',
        response: `{
  "items": [
    {
      "id":                   "64f1a2b3...",
      "trainer_name":         "my-classifier",
      "mlflow_model_version": "3",
      "is_default":           true,
      "status":               "active",
      "metrics":              { "accuracy": 0.947, "f1": 0.941 },
      "created_at":           "2026-03-13T10:12:30Z"
    }
  ]
}`,
        curlExample: `curl "${BASE_URL}/api/v1/models?trainer_name=my-classifier" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get("${BASE_URL}/api/v1/models",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    params={"trainer_name": "my-classifier", "include_all": True})
for m in resp.json()["items"]:
    print(f"v{m['mlflow_model_version']} — {m['metrics']}")`,
        livePath: '/api/v1/models',
      },
      {
        method: 'DELETE',
        path: '/api/v1/models/:id',
        summary: 'Delete a model deployment record',
        description: 'Removes the deployment record for a specific model version. The underlying MLflow artifact is not deleted. If this was the default model for a trainer, the previous version (if any) becomes the new default.',
        auth: true,
        response: `{ "ok": true }`,
        curlExample: `curl -X DELETE ${BASE_URL}/api/v1/models/MODEL_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

model_id = "64f1a2b3..."
resp = requests.delete(
    f"${BASE_URL}/api/v1/models/{model_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
print(resp.json())  # {"ok": true}`,
        livePath: '/api/v1/models',
      },
    ],
  },
  {
    title: 'Trainers',
    description: 'Manage your trainer plugins. A trainer is a Python file that subclasses BaseTrainer and implements train() and predict(). You can upload plugins directly via API, or place them in the /trainers/ directory and trigger a scan.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/trainers',
        summary: 'List registered trainer plugins',
        description: 'Returns all trainer plugins registered in your account. Each trainer has a name (used in training and inference API paths), a framework identifier, version, and metadata. Only active trainers can be used to start jobs.',
        auth: true,
        response: `{
  "items": [
    {
      "name":        "my-classifier",
      "version":     "1.0.0",
      "framework":   "sklearn",
      "description": "Iris species classifier",
      "is_active":   true,
      "created_at":  "2026-03-01T09:00:00Z"
    }
  ]
}`,
        curlExample: `curl ${BASE_URL}/api/v1/trainers \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get("${BASE_URL}/api/v1/trainers",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
for t in resp.json()["items"]:
    print(t["name"], t["framework"])`,
        livePath: '/api/v1/trainers',
      },
      {
        method: 'POST',
        path: '/api/v1/trainers/scan',
        summary: 'Rescan /trainers/ directory for new plugins',
        description: 'Triggers a file system scan of the /trainers/ directory on the MLDock server. Any .py files that subclass BaseTrainer are automatically discovered, imported, and registered. Useful after dropping new files onto the server or making edits.',
        auth: true,
        response: `{
  "discovered":  ["my-classifier", "fraud-detector"],
  "registered":  2,
  "skipped":     0
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/trainers/scan \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.post("${BASE_URL}/api/v1/trainers/scan",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
print(resp.json())
# {"discovered": ["my-classifier"], "registered": 1, "skipped": 0}`,
        livePath: '/api/v1/trainers/scan',
      },
      {
        method: 'POST',
        path: '/api/v1/trainers/upload',
        summary: 'Upload a trainer .py file directly',
        description: 'Upload a Python trainer file as multipart/form-data. The file is saved to the /trainers/ directory, imported, and registered immediately. The trainer must subclass BaseTrainer and define at minimum train() and predict() methods. The class name becomes the trainer\'s registered name.',
        auth: true,
        body: 'multipart/form-data — field: file (*.py)',
        response: `{
  "uploaded":            "my_classifier.py",
  "trainers_registered": 1,
  "name":                "my-classifier"
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/trainers/upload \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "file=@./my_classifier.py"`,
        pythonExample: `import requests

with open("my_classifier.py", "rb") as f:
    resp = requests.post(
        "${BASE_URL}/api/v1/trainers/upload",
        headers={"Authorization": "Bearer YOUR_API_KEY"},
        files={"file": ("my_classifier.py", f, "text/plain")})
print(resp.json())
# {"uploaded": "my_classifier.py", "trainers_registered": 1}`,
        livePath: '/api/v1/trainers',
      },
    ],
  },
  {
    title: 'API Keys',
    description: 'Create and manage long-lived API keys for programmatic access. API keys are the preferred auth method for production integrations — they don\'t expire and can be individually revoked. The full key is only shown once at creation time.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/api-keys',
        summary: 'List your API keys',
        description: 'Returns metadata for all your active API keys. The full key value is never returned after creation — only the prefix (first 8 characters) for identification. Use this to audit which keys exist before revoking.',
        auth: true,
        response: `{
  "items": [
    {
      "id":         "64f1a2b3...",
      "name":       "prod-key",
      "prefix":     "mlv_ab12",
      "created_at": "2026-03-01T09:00:00Z",
      "last_used":  "2026-03-13T08:42:11Z"
    }
  ]
}`,
        curlExample: `curl ${BASE_URL}/api/v1/api-keys \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get("${BASE_URL}/api/v1/api-keys",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
for k in resp.json()["items"]:
    print(k["name"], k["prefix"])`,
        livePath: '/api/v1/api-keys',
      },
      {
        method: 'POST',
        path: '/api/v1/api-keys',
        summary: 'Create a new API key',
        description: 'Generates a new API key and returns it. The full key is returned exactly once in this response — store it immediately in a secrets manager or environment variable. After this call, only the key prefix is retrievable.',
        auth: true,
        body: `{ "name": "prod-key" }`,
        response: `{
  "id":     "64f1a2b3...",
  "name":   "prod-key",
  "key":    "mlv_ab12cdef...  ← shown once — save it now",
  "prefix": "mlv_ab12"
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/api-keys \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "prod-key" }'`,
        pythonExample: `import requests

# Use your JWT token from login to create an API key
resp = requests.post("${BASE_URL}/api/v1/api-keys",
    headers={"Authorization": "Bearer YOUR_JWT_TOKEN"},
    json={"name": "prod-key"})
data = resp.json()
api_key = data["key"]  # save this — shown once only
print("API key:", api_key)`,
        livePath: '/api/v1/api-keys',
        liveBody: { name: 'my-key' },
      },
      {
        method: 'DELETE',
        path: '/api/v1/api-keys/:id',
        summary: 'Revoke an API key',
        description: 'Permanently revokes the key. Any requests using this key will immediately start receiving 401 errors. This cannot be undone — create a new key if you need to restore access.',
        auth: true,
        response: `{ "ok": true }`,
        curlExample: `curl -X DELETE ${BASE_URL}/api/v1/api-keys/KEY_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

key_id = "64f1a2b3..."
resp = requests.delete(
    f"${BASE_URL}/api/v1/api-keys/{key_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
print(resp.json())  # {"ok": true}`,
        livePath: '/api/v1/api-keys',
      },
    ],
  },
  {
    title: 'A/B Testing',
    description: 'Split live inference traffic between two model versions to compare them in production. MLDock routes a configurable percentage of requests to each variant and tracks per-variant metrics (accuracy, latency, error rate) independently — letting you promote the winner without any downtime.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/ab-tests',
        summary: 'List all A/B tests',
        description: 'Returns all A/B tests in your account — active, paused, and completed. Each test record includes the two model variants being compared, the current traffic split, request counts, and aggregated metrics per variant.',
        auth: true,
        params: 'trainer_name (optional), status (active | paused | completed)',
        response: `{
  "items": [
    {
      "id":           "abt_64f1a2b3...",
      "trainer_name": "my-classifier",
      "status":       "active",
      "variant_a": {
        "model_version": "2",
        "traffic_pct":   70,
        "requests":      1420,
        "avg_latency_ms": 11,
        "error_rate_pct": 0.1
      },
      "variant_b": {
        "model_version": "3",
        "traffic_pct":   30,
        "requests":      610,
        "avg_latency_ms": 9,
        "error_rate_pct": 0.0
      },
      "created_at": "2026-03-10T08:00:00Z"
    }
  ]
}`,
        curlExample: `curl "${BASE_URL}/api/v1/ab-tests?trainer_name=my-classifier" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get("${BASE_URL}/api/v1/ab-tests",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    params={"trainer_name": "my-classifier", "status": "active"})
for test in resp.json()["items"]:
    a = test["variant_a"]
    b = test["variant_b"]
    print(f"v{a['model_version']} ({a['traffic_pct']}%) vs v{b['model_version']} ({b['traffic_pct']}%)")`,
        livePath: '/api/v1/ab-tests',
      },
      {
        method: 'POST',
        path: '/api/v1/ab-tests',
        summary: 'Create an A/B test between two model versions',
        description: 'Starts routing live inference traffic between two model versions for the same trainer. Set `traffic_pct` for variant A — the remainder goes to variant B. Both versions must already be deployed. The test remains active until you explicitly stop it or promote a winner. All requests through the standard `/inference/:trainer_name/predict` endpoint are automatically split.',
        auth: true,
        body: `{
  "trainer_name":    "my-classifier",
  "model_version_a": "2",
  "model_version_b": "3",
  "traffic_pct_a":   70
}`,
        response: `{
  "id":           "abt_64f1a2b3...",
  "trainer_name": "my-classifier",
  "status":       "active",
  "variant_a":    { "model_version": "2", "traffic_pct": 70 },
  "variant_b":    { "model_version": "3", "traffic_pct": 30 },
  "created_at":   "2026-03-13T10:00:00Z"
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/ab-tests \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "trainer_name":    "my-classifier",
    "model_version_a": "2",
    "model_version_b": "3",
    "traffic_pct_a":   70
  }'`,
        pythonExample: `import requests

resp = requests.post("${BASE_URL}/api/v1/ab-tests",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "trainer_name":    "my-classifier",
        "model_version_a": "2",
        "model_version_b": "3",
        "traffic_pct_a":   70,  # 70% to v2, 30% to v3
    })
test = resp.json()
print("A/B test started:", test["id"])`,
        livePath: '/api/v1/ab-tests',
        liveBody: { trainer_name: 'my-classifier', model_version_a: '1', model_version_b: '2', traffic_pct_a: 80 },
      },
      {
        method: 'POST',
        path: '/api/v1/ab-tests/:id/promote',
        summary: 'Promote the winning variant to 100% traffic',
        description: 'Ends the A/B test and routes 100% of traffic to the specified winner. The losing version remains deployed but receives no traffic. Use this once you have statistical confidence that one variant outperforms the other.',
        auth: true,
        body: `{
  "winner": "b"
}`,
        response: `{
  "ok":              true,
  "promoted_version": "3",
  "test_status":     "completed"
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/ab-tests/ABT_ID/promote \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "winner": "b" }'`,
        pythonExample: `import requests

test_id = "abt_64f1a2b3..."
resp = requests.post(
    f"${BASE_URL}/api/v1/ab-tests/{test_id}/promote",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"winner": "b"})  # promote variant B (model version 3)
print(resp.json())`,
        livePath: '/api/v1/ab-tests',
      },
      {
        method: 'DELETE',
        path: '/api/v1/ab-tests/:id',
        summary: 'Stop and delete an A/B test',
        description: 'Stops traffic splitting immediately. Traffic reverts to the current default model. The test record is deleted. Neither model version is affected.',
        auth: true,
        response: `{ "ok": true }`,
        curlExample: `curl -X DELETE ${BASE_URL}/api/v1/ab-tests/ABT_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

test_id = "abt_64f1a2b3..."
resp = requests.delete(
    f"${BASE_URL}/api/v1/ab-tests/{test_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
print(resp.json())  # {"ok": true}`,
        livePath: '/api/v1/ab-tests',
      },
    ],
  },
  {
    title: 'Batch Inference',
    description: 'Submit large datasets for offline prediction. Instead of calling the predict endpoint row-by-row, upload a CSV or JSON file and MLDock processes it asynchronously, returning a downloadable results file when complete. Ideal for scoring large datasets, nightly reporting pipelines, or bulk re-classification.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/batch/:trainer_name',
        summary: 'Submit a batch inference job',
        description: 'Upload a CSV or JSON file of input records. Each row is passed through your trainer\'s predict() method. The job runs asynchronously — use the returned `job_id` to poll for status. Supports up to 1 million rows per job. For CSV files, the first row must be the header matching your trainer\'s input schema field names.',
        auth: true,
        body: 'multipart/form-data — field: file (*.csv or *.json)',
        response: `{
  "job_id":       "bat_64f1a2b3...",
  "status":       "queued",
  "trainer_name": "my-classifier",
  "row_count":    5000,
  "created_at":   "2026-03-13T10:00:00Z"
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/batch/my-classifier \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "file=@./dataset.csv"`,
        pythonExample: `import requests

with open("dataset.csv", "rb") as f:
    resp = requests.post(
        "${BASE_URL}/api/v1/batch/my-classifier",
        headers={"Authorization": "Bearer YOUR_API_KEY"},
        files={"file": ("dataset.csv", f, "text/csv")})

job = resp.json()
print("Batch job queued:", job["job_id"], f"({job['row_count']} rows)")`,
        livePath: '/api/v1/batch',
      },
      {
        method: 'GET',
        path: '/api/v1/batch/:trainer_name',
        summary: 'List batch jobs for a trainer',
        description: 'Returns all batch jobs submitted for a trainer, ordered by most recent first. Each entry shows the current status (`queued`, `running`, `completed`, `failed`), how many rows were processed, and where to download the result file when complete.',
        auth: true,
        params: 'page (default 1), page_size (default 20)',
        response: `{
  "items": [
    {
      "id":           "bat_64f1a2b3...",
      "trainer_name": "my-classifier",
      "status":       "completed",
      "row_count":    5000,
      "processed":    5000,
      "errors":       2,
      "result_url":   "https://...",
      "created_at":   "2026-03-13T10:00:00Z",
      "completed_at": "2026-03-13T10:02:15Z"
    }
  ],
  "total": 1
}`,
        curlExample: `curl "${BASE_URL}/api/v1/batch/my-classifier" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests, time

# Submit job
with open("dataset.csv", "rb") as f:
    job = requests.post("${BASE_URL}/api/v1/batch/my-classifier",
        headers={"Authorization": "Bearer YOUR_API_KEY"},
        files={"file": ("dataset.csv", f, "text/csv")}).json()

job_id = job["job_id"]

# Poll until done
while True:
    jobs = requests.get("${BASE_URL}/api/v1/batch/my-classifier",
        headers={"Authorization": "Bearer YOUR_API_KEY"}).json()
    job = next(j for j in jobs["items"] if j["id"] == job_id)
    print("Status:", job["status"])
    if job["status"] in ("completed", "failed"):
        break
    time.sleep(3)

print("Results:", job.get("result_url"))`,
        livePath: '/api/v1/batch',
      },
    ],
  },
  {
    title: 'Monitoring',
    description: 'Track live inference performance, detect data/concept drift, and manage drift alerts per model. MLDock snapshots latency, error rate, and prediction distribution every few minutes. Set a baseline from recent traffic and run drift checks to catch degradation before it hurts users.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/monitoring/overview',
        summary: 'Get a health overview of all deployed models',
        description: 'Returns a summary row for every deployed model: total requests, error rate, average latency, and open drift alert count. Use this as your monitoring dashboard entry point.',
        auth: true,
        response: `{
  "models": [
    {
      "trainer_name":     "my-classifier",
      "total_requests":   18420,
      "error_rate_pct":   0.3,
      "avg_latency_ms":   12,
      "open_alerts":      1,
      "last_snapshot_at": "2026-03-13T10:55:00Z"
    }
  ]
}`,
        curlExample: `curl "${BASE_URL}/api/v1/monitoring/overview" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get("${BASE_URL}/api/v1/monitoring/overview",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
for m in resp.json()["models"]:
    print(m["trainer_name"], "errors:", m["error_rate_pct"], "%",
          "alerts:", m["open_alerts"])`,
        livePath: '/api/v1/monitoring/overview',
      },
      {
        method: 'GET',
        path: '/api/v1/monitoring/performance/:trainer_name',
        summary: 'Get time-series performance snapshots',
        description: 'Returns per-minute (or per-interval) snapshots of requests, latency, and error rate for the last N hours. Use this to plot latency/error trends or feed your own alerting system.',
        auth: true,
        params: 'hours (default 24, max 168)',
        response: `{
  "trainer_name": "my-classifier",
  "snapshots": [
    {
      "ts":             "2026-03-13T10:00:00Z",
      "requests":       142,
      "errors":         0,
      "avg_latency_ms": 11,
      "p99_latency_ms": 28
    }
  ]
}`,
        curlExample: `curl "${BASE_URL}/api/v1/monitoring/performance/my-classifier?hours=24" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get(
    "${BASE_URL}/api/v1/monitoring/performance/my-classifier",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    params={"hours": 24})
for snap in resp.json()["snapshots"]:
    print(snap["ts"], "→", snap["avg_latency_ms"], "ms",
          snap["requests"], "reqs")`,
        livePath: '/api/v1/monitoring/performance',
      },
      {
        method: 'GET',
        path: '/api/v1/monitoring/performance/:trainer_name/summary',
        summary: 'Get rolling performance summary',
        description: 'Returns a single aggregated summary over the requested window: total requests, error count, p50/p95/p99 latency, and requests-per-second. Useful for status badges or SLA reporting.',
        auth: true,
        params: 'hours (default 24)',
        response: `{
  "trainer_name":   "my-classifier",
  "hours":          24,
  "total_requests": 18420,
  "total_errors":   55,
  "error_rate_pct": 0.3,
  "avg_latency_ms": 12,
  "p95_latency_ms": 31,
  "p99_latency_ms": 58,
  "req_per_second": 0.21
}`,
        curlExample: `curl "${BASE_URL}/api/v1/monitoring/performance/my-classifier/summary?hours=24" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get(
    "${BASE_URL}/api/v1/monitoring/performance/my-classifier/summary",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    params={"hours": 24})
s = resp.json()
print(f"p95={s['p95_latency_ms']}ms  errors={s['error_rate_pct']}%  rps={s['req_per_second']}")`,
        livePath: '/api/v1/monitoring/performance',
      },
      {
        method: 'POST',
        path: '/api/v1/monitoring/drift/:trainer_name/baseline',
        summary: 'Set a drift baseline from recent traffic',
        description: 'Samples the last N inference requests and stores the input feature distribution as the baseline. All future drift checks compare against this snapshot. Re-run after major retraining to reset the reference point.',
        auth: true,
        body: `{
  "sample_count": 500
}`,
        response: `{
  "ok":           true,
  "trainer_name": "my-classifier",
  "sample_count": 500,
  "baseline_set_at": "2026-03-13T10:00:00Z"
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/monitoring/drift/my-classifier/baseline \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "sample_count": 500 }'`,
        pythonExample: `import requests

resp = requests.post(
    "${BASE_URL}/api/v1/monitoring/drift/my-classifier/baseline",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"sample_count": 500})
print(resp.json())  # {"ok": true, "sample_count": 500, ...}`,
        liveBody: { sample_count: 500 },
        livePath: '/api/v1/monitoring/drift',
      },
      {
        method: 'GET',
        path: '/api/v1/monitoring/drift/:trainer_name/baseline',
        summary: 'Get the current drift baseline',
        description: 'Returns the stored baseline statistics (feature means, standard deviations, and categorical distributions) along with when it was last set and how many samples it was built from.',
        auth: true,
        response: `{
  "trainer_name":    "my-classifier",
  "sample_count":    500,
  "baseline_set_at": "2026-03-13T10:00:00Z",
  "feature_stats": {
    "age":    { "mean": 34.2, "std": 12.1 },
    "income": { "mean": 52100, "std": 18400 }
  }
}`,
        curlExample: `curl "${BASE_URL}/api/v1/monitoring/drift/my-classifier/baseline" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get(
    "${BASE_URL}/api/v1/monitoring/drift/my-classifier/baseline",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
baseline = resp.json()
print("Baseline set:", baseline["baseline_set_at"],
      "from", baseline["sample_count"], "samples")`,
        livePath: '/api/v1/monitoring/drift',
      },
      {
        method: 'POST',
        path: '/api/v1/monitoring/drift/:trainer_name/check',
        summary: 'Run a drift check against the baseline',
        description: 'Samples recent inference requests and computes statistical drift scores (KL divergence for continuous features, chi-squared for categoricals) against the stored baseline. If any feature exceeds the drift threshold a new alert is created automatically.',
        auth: true,
        body: `{
  "sample_count": 200,
  "hours":        6
}`,
        response: `{
  "trainer_name":  "my-classifier",
  "drift_detected": true,
  "features": {
    "age":    { "score": 0.04, "drifted": false },
    "income": { "score": 0.31, "drifted": true  }
  },
  "alert_id": "dft_9a2b3c..."
}`,
        curlExample: `curl -X POST ${BASE_URL}/api/v1/monitoring/drift/my-classifier/check \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "sample_count": 200, "hours": 6 }'`,
        pythonExample: `import requests

resp = requests.post(
    "${BASE_URL}/api/v1/monitoring/drift/my-classifier/check",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"sample_count": 200, "hours": 6})
result = resp.json()
if result["drift_detected"]:
    drifted = [f for f, s in result["features"].items() if s["drifted"]]
    print("Drift detected in:", drifted)`,
        liveBody: { sample_count: 200, hours: 6 },
        livePath: '/api/v1/monitoring/drift',
      },
      {
        method: 'GET',
        path: '/api/v1/monitoring/drift/:trainer_name/alerts',
        summary: 'List drift alerts for a model',
        description: 'Returns all drift alerts for the given trainer. Filter by `status` to see only open alerts. Each alert includes which features drifted, the drift scores, and when it was detected.',
        auth: true,
        params: 'status (open | acknowledged | resolved)',
        response: `{
  "alerts": [
    {
      "id":           "dft_9a2b3c...",
      "trainer_name": "my-classifier",
      "status":       "open",
      "drifted_features": ["income"],
      "max_drift_score":   0.31,
      "detected_at":  "2026-03-13T10:10:00Z"
    }
  ]
}`,
        curlExample: `curl "${BASE_URL}/api/v1/monitoring/drift/my-classifier/alerts?status=open" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get(
    "${BASE_URL}/api/v1/monitoring/drift/my-classifier/alerts",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    params={"status": "open"})
for alert in resp.json()["alerts"]:
    print(alert["id"], "— drifted:", alert["drifted_features"])`,
        livePath: '/api/v1/monitoring/drift',
      },
      {
        method: 'PATCH',
        path: '/api/v1/monitoring/drift/alerts/:alert_id',
        summary: 'Acknowledge or resolve a drift alert',
        description: 'Update the status of a drift alert. Set to `acknowledged` when you are investigating, or `resolved` once you have retrained or confirmed the drift is acceptable. An optional notes field lets you record your finding.',
        auth: true,
        body: `{
  "status": "resolved",
  "notes":  "Retrained on March 2026 data — drift corrected."
}`,
        response: `{
  "id":           "dft_9a2b3c...",
  "status":       "resolved",
  "resolved_at":  "2026-03-13T11:00:00Z"
}`,
        curlExample: `curl -X PATCH ${BASE_URL}/api/v1/monitoring/drift/alerts/ALERT_ID \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "resolved", "notes": "Retrained on latest data." }'`,
        pythonExample: `import requests

alert_id = "dft_9a2b3c..."
resp = requests.patch(
    f"${BASE_URL}/api/v1/monitoring/drift/alerts/{alert_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"status": "resolved", "notes": "Retrained on latest data."})
print(resp.json())`,
        livePath: '/api/v1/monitoring/drift/alerts',
      },
    ],
  },
  {
    title: 'Model Comparison',
    description: 'Compare metrics across multiple trained model versions side-by-side. Use this to decide which version to promote, or to analyse the impact of hyperparameter changes over training runs.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/models/compare',
        summary: 'Compare metrics across model versions',
        description: 'Returns metrics for multiple model versions in a single call, normalised for easy side-by-side comparison. Pass up to 10 model IDs. The response includes every metric key that any of the versions recorded, with `null` for versions that did not record a particular metric. Also returns training metadata: GPU type, duration, and cost — useful for cost-performance tradeoff analysis.',
        auth: true,
        params: 'ids (comma-separated model IDs, required)',
        response: `{
  "models": [
    {
      "id":             "64f1a2b3...",
      "trainer_name":   "my-classifier",
      "version":        "2",
      "is_default":     false,
      "metrics": {
        "accuracy":  0.921,
        "f1":        0.917,
        "precision": 0.930,
        "recall":    0.904
      },
      "training_meta": {
        "compute_type":   "cloud_gpu",
        "gpu_type":       "RTX 3090",
        "duration_min":   8.4,
        "wallet_charged": 0.067
      },
      "created_at": "2026-03-10T09:00:00Z"
    },
    {
      "id":             "64f1a2b4...",
      "trainer_name":   "my-classifier",
      "version":        "3",
      "is_default":     true,
      "metrics": {
        "accuracy":  0.947,
        "f1":        0.941,
        "precision": 0.955,
        "recall":    0.928
      },
      "training_meta": {
        "compute_type":   "cloud_gpu",
        "gpu_type":       "RTX 3090",
        "duration_min":   10.1,
        "wallet_charged": 0.081
      },
      "created_at": "2026-03-13T10:12:30Z"
    }
  ],
  "metric_keys": ["accuracy", "f1", "precision", "recall"]
}`,
        curlExample: `curl "${BASE_URL}/api/v1/models/compare?ids=64f1a2b3...,64f1a2b4..." \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

model_ids = ["64f1a2b3...", "64f1a2b4..."]

resp = requests.get("${BASE_URL}/api/v1/models/compare",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    params={"ids": ",".join(model_ids)})

data = resp.json()
print(f"{'Version':<10}", *[k[:10] for k in data["metric_keys"]])
for m in data["models"]:
    row = [f"v{m['version']:<9}"]
    for k in data["metric_keys"]:
        val = m["metrics"].get(k)
        row.append(f"{val:.3f}" if val is not None else "N/A")
    print(*row)`,
        livePath: '/api/v1/models/compare',
      },
      {
        method: 'GET',
        path: '/api/v1/models/:id/metrics-history',
        summary: 'Get metric trends across all versions of a trainer',
        description: 'Returns a time-series of metrics across every training run for a trainer, ordered chronologically. Useful for plotting learning curves, detecting regressions, or understanding the improvement trajectory of a model over time.',
        auth: true,
        response: `{
  "trainer_name": "my-classifier",
  "history": [
    { "version": "1", "created_at": "2026-03-01T...", "metrics": { "accuracy": 0.880 } },
    { "version": "2", "created_at": "2026-03-10T...", "metrics": { "accuracy": 0.921 } },
    { "version": "3", "created_at": "2026-03-13T...", "metrics": { "accuracy": 0.947 } }
  ]
}`,
        curlExample: `curl "${BASE_URL}/api/v1/models/my-classifier/metrics-history" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        pythonExample: `import requests

resp = requests.get(
    "${BASE_URL}/api/v1/models/my-classifier/metrics-history",
    headers={"Authorization": "Bearer YOUR_API_KEY"})

history = resp.json()["history"]
for entry in history:
    acc = entry["metrics"].get("accuracy", "N/A")
    print(f"v{entry['version']} — accuracy: {acc}")`,
        livePath: '/api/v1/models',
      },
    ],
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function useCopy(text: string) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return { copied, copy }
}

function CodeBlock({ code, lang = 'bash', label }: { code: string; lang?: string; label?: string }) {
  const { copied, copy } = useCopy(code)
  return (
    <div className="rounded-xl border border-white/6 overflow-hidden bg-[#0d1117]">
      {label && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
          <span className="text-[10px] text-gray-500 font-mono">{label}</span>
          <button onClick={copy} className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-300 transition-colors">
            {copied ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      )}
      <pre className={clsx('px-4 py-4 text-xs font-mono leading-relaxed overflow-x-auto', lang === 'python' ? 'text-sky-200/80' : 'text-emerald-300/80')}>
        {code}
      </pre>
    </div>
  )
}

// ── Inline sign-in (returns JWT, used directly as Bearer) ─────────────────────

function InlineSignIn({ onGotKey }: { onGotKey: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (!email || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.detail ?? data?.error?.message ?? 'Login failed')
        setLoading(false)
        return
      }
      const jwt = data.access_token ?? data.token
      if (!jwt) { setError('No token in response'); setLoading(false); return }
      onGotKey(jwt)
      setDone(true)
      setOpen(false)
    } catch {
      setError('Network error — is the API reachable?')
    }
    setLoading(false)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1">
        {done ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Key size={11} />}
        {done ? 'Signed in' : 'Sign in to authenticate'}
        {!done && <ChevronRight size={11} />}
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-sky-800/30 bg-sky-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-sky-300 flex items-center gap-1.5">
          <Key size={12} /> Sign in to run live requests
        </span>
        <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-gray-400">
          <X size={13} />
        </button>
      </div>
      <input type="email" placeholder="Email" value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        className="w-full bg-[#0d1117] border border-white/6 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-sky-600/50"
      />
      <input type="password" placeholder="Password" value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        className="w-full bg-[#0d1117] border border-white/6 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-sky-600/50"
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <button onClick={submit} disabled={loading || !email || !password}
        className="w-full py-2 bg-sky-700/60 hover:bg-sky-700/80 border border-sky-600/30 rounded-lg text-xs font-semibold text-sky-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
        {loading && <Loader2 size={12} className="animate-spin" />}
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </div>
  )
}

/** Returns auth headers appropriate for the token type.
 *  JWT (3 dot-separated segments) → Authorization: Bearer
 *  API key (mlv_ prefix)          → X-Api-Key
 */
function authHeaders(token: string): Record<string, string> {
  if (!token) return {}
  // API key — must go in X-Api-Key, NOT Authorization Bearer
  if (token.startsWith('mlv_') || token.split('.').length !== 3) {
    return { 'X-Api-Key': token }
  }
  return { Authorization: `Bearer ${token}` }
}

// ── Live test panel ────────────────────────────────────────────────────────────

function LiveTest({ ep, apiKey, onGotKey }: { ep: Endpoint; apiKey: string; onGotKey: (k: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [status, setStatus] = useState<number | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const isApiKey = apiKey.startsWith('mlv_')

  if (!apiKey) {
    return (
      <div className="rounded-xl border border-amber-800/30 bg-amber-950/20 px-4 py-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <Lock size={13} className="text-amber-500 flex-shrink-0" />
          <span className="text-xs text-amber-200/60 flex-1">Sign in or paste an API key in the sidebar to run live requests</span>
        </div>
        <InlineSignIn onGotKey={onGotKey} />
      </div>
    )
  }

  const run = async () => {
    setLoading(true)
    setResult(null)
    try {
      const path = ep.livePath ?? ep.path.replace(/\/:\w+/g, '')
      const url = BASE_URL + path
      const isPost = ep.method === 'POST' && ep.liveBody !== undefined
      let bodyStr = ''
      if (isPost && bodyRef.current) bodyStr = bodyRef.current.value

      const opts: RequestInit = {
        method: isPost ? 'POST' : 'GET',
        headers: {
          ...authHeaders(apiKey),
          ...(isPost ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(isPost && bodyStr ? { body: bodyStr } : {}),
      }
      const res = await fetch(url, opts)
      setStatus(res.status)
      const text = await res.text()
      try { setResult(JSON.stringify(JSON.parse(text), null, 2)) }
      catch { setResult(text) }
    } catch (e) {
      setResult(String(e))
      setStatus(0)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-3">
      {/* Token type indicator */}
      <div className="flex items-center gap-2 text-[10px] text-gray-600">
        <CheckCircle2 size={10} className="text-emerald-500" />
        {isApiKey ? 'Using API key via X-Api-Key header' : 'Using session token via Authorization: Bearer'}
      </div>
      {ep.method === 'POST' && ep.liveBody && (
        <div>
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Request body</div>
          <textarea ref={bodyRef}
            defaultValue={JSON.stringify(ep.liveBody, null, 2)}
            className="w-full bg-[#0d1117] border border-white/6 rounded-xl px-3 py-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-sky-600/50 resize-none"
            rows={6}
          />
        </div>
      )}
      <button onClick={run} disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-sky-700/40 hover:bg-sky-700/60 border border-sky-600/30 rounded-xl text-xs font-semibold text-sky-300 transition-colors disabled:opacity-50">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        {loading ? 'Running...' : 'Run request'}
      </button>
      {result !== null && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-[10px] text-gray-600 uppercase tracking-widest">Response</div>
            {status !== null && (
              <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded', status >= 200 && status < 300 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400')}>
                {status}
              </span>
            )}
          </div>
          <pre className="text-xs font-mono text-emerald-300/80 bg-[#0d1117] border border-white/6 rounded-xl px-4 py-3 overflow-x-auto max-h-60">
            {result}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Endpoint card ──────────────────────────────────────────────────────────────

function EndpointCard({ ep, apiKey, onGotKey }: { ep: Endpoint; apiKey: string; onGotKey: (k: string) => void }) {
  const [open, setOpen] = useState(false)
  const [codeTab, setCodeTab] = useState<'curl' | 'python'>('curl')
  const { copied, copy } = useCopy(`${BASE_URL}${ep.path}`)

  return (
    <div className="border border-white/6 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.02] transition-colors text-left">
        <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded border font-mono flex-shrink-0', METHOD_COLOR[ep.method])}>
          {ep.method}
        </span>
        <code className="text-sm text-gray-200 font-mono flex-1 truncate">{ep.path}</code>
        {ep.auth && (
          <span className="text-[10px] text-amber-500/80 border border-amber-800/30 rounded px-1.5 py-0.5 hidden sm:flex items-center gap-1">
            <Key size={9} /> auth
          </span>
        )}
        <button onClick={e => { e.stopPropagation(); copy() }} className="text-gray-600 hover:text-gray-400 p-1 flex-shrink-0">
          {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        {open ? <ChevronDown size={13} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-500 flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-white/5 px-5 py-5 space-y-5 bg-[#090e18]">
          {/* Summary + description */}
          <div>
            <p className="text-sm font-medium text-white mb-1.5">{ep.summary}</p>
            <p className="text-sm text-gray-500 leading-relaxed">{ep.description}</p>
          </div>

          {/* Query params */}
          {ep.params && (
            <div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Query params</div>
              <code className="text-xs text-gray-400 bg-[#0d1117] border border-white/6 rounded-lg px-3 py-2 block">{ep.params}</code>
            </div>
          )}

          {/* Request body */}
          {ep.body && ep.body !== 'multipart/form-data — field: file (*.py)' && (
            <div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Request body</div>
              <CodeBlock code={ep.body} lang="json" />
            </div>
          )}
          {ep.body === 'multipart/form-data — field: file (*.py)' && (
            <div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Request body</div>
              <code className="text-xs text-gray-400 bg-[#0d1117] border border-white/6 rounded-lg px-3 py-2 block">multipart/form-data — field: <span className="text-sky-400">file</span> (*.py)</code>
            </div>
          )}

          {/* Response */}
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Response</div>
            <CodeBlock code={ep.response} lang="json" />
          </div>

          {/* Code samples */}
          <div>
            <div className="flex items-center gap-1 mb-2">
              {(['curl', 'python'] as const).map(t => (
                <button key={t} onClick={() => setCodeTab(t)}
                  className={clsx('px-3 py-1 text-[11px] font-medium rounded-lg transition-colors',
                    codeTab === t ? 'bg-gray-800 text-white' : 'text-gray-600 hover:text-gray-400')}>
                  {t === 'curl' ? 'cURL' : 'Python'}
                </button>
              ))}
            </div>
            <CodeBlock
              code={codeTab === 'curl' ? ep.curlExample : ep.pythonExample}
              lang={codeTab === 'curl' ? 'bash' : 'python'}
              label={codeTab === 'curl' ? 'shell' : 'python'}
            />
          </div>

          {/* Live test */}
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">Live test</div>
            <LiveTest ep={ep} apiKey={apiKey} onGotKey={onGotKey} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ApiDocsPage({ onBack, onSignIn, onGettingStarted, onPrivacy, onTerms, initialSection }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)

  useEffect(() => {
    if (!initialSection) return
    const id = initialSection.toLowerCase().replace(/\s+/g, '-')
    // Delay to allow render
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [initialSection])

  return (
    <div className="min-h-screen bg-[#060810] text-white">
      {/* Nav */}
      <nav className="border-b border-white/5 sticky top-0 z-50 bg-[#060810]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={14} />
            <Logo size="sm" />
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onGettingStarted} className="text-xs text-gray-500 hover:text-gray-300 transition-colors hidden sm:block">Getting started</button>
            <button onClick={onSignIn}
              className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg transition-colors">
              Sign in
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid lg:grid-cols-[220px_1fr] gap-10">

          {/* Sidebar TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-1">
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-3 px-2">Sections</div>
              {SECTIONS.map(s => (
                <a key={s.title} href={`#${s.title.toLowerCase().replace(/\s+/g, '-')}`}
                  className="block px-2 py-1.5 text-xs text-gray-500 hover:text-gray-200 hover:bg-white/[0.04] rounded-lg transition-colors">
                  {s.title}
                </a>
              ))}
              <div className="pt-4 border-t border-white/5 mt-4">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2 px-2">Live test key</div>
                <div className="px-2">
                  <div className="relative">
                    <input
                      type={keyVisible ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="mlv_..."
                      className="w-full bg-[#0d1117] border border-white/6 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-300 placeholder-gray-700 focus:outline-none focus:border-sky-600/50"
                    />
                    <button onClick={() => setKeyVisible(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-[10px]">
                      {keyVisible ? 'hide' : 'show'}
                    </button>
                  </div>
                  {!apiKey && (
                    <div className="mt-2">
                      <InlineSignIn onGotKey={k => { setApiKey(k) }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* Content */}
          <div className="space-y-14 min-w-0">
            {/* Header */}
            <div>
              <div className="text-[10px] text-sky-500 font-bold uppercase tracking-widest mb-2">REST API</div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight">API Reference</h1>
              <p className="text-gray-400 leading-relaxed max-w-2xl mb-6">
                All endpoints live under <code className="text-sky-300 bg-[#0d1117] px-1.5 py-0.5 rounded text-sm font-mono">{BASE_URL}/api/v1/</code>.
                Authenticate with a Bearer token from login or an API key (preferred for production).
              </p>

              {/* Mobile API key input */}
              <div className="lg:hidden mb-6 bg-[#0d1117] border border-white/6 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
                  <Key size={12} /> API key for live tests
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="Paste your API key here (mlv_...)"
                    className="flex-1 bg-[#060810] border border-white/6 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 placeholder-gray-700 focus:outline-none focus:border-sky-600/50"
                  />
                  {!apiKey && <InlineSignIn onGotKey={k => setApiKey(k)} />}
                </div>
              </div>

              {/* Auth note */}
              <div className="bg-[#0d1117] border border-white/6 rounded-xl p-4 space-y-3">
                <div className="text-xs font-medium text-gray-300">Authentication header</div>
                <CodeBlock code={`# Using an API key (recommended for production):
Authorization: Bearer mlv_your_api_key_here

# Using a JWT token (from login, for short-term use):
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`} lang="bash" />
                <div className="text-xs text-gray-600">
                  Base URL: <code className="text-gray-400">{BASE_URL}</code>
                </div>
              </div>

              {/* Error format */}
              <div className="mt-4 bg-[#0d1117] border border-white/6 rounded-xl p-4 space-y-3">
                <div className="text-xs font-medium text-gray-300">Error envelope</div>
                <p className="text-xs text-gray-500">All errors return the same JSON shape regardless of status code:</p>
                <CodeBlock code={`{
  "error": {
    "code":    "INSUFFICIENT_BALANCE",
    "message": "Wallet balance is too low for this GPU job",
    "details": {}
  }
}`} lang="json" />
              </div>
            </div>

            {/* Sections */}
            {SECTIONS.map(section => (
              <div key={section.title} id={section.title.toLowerCase().replace(/\s+/g, '-')} className="scroll-mt-24 space-y-4">
                <div className="border-b border-white/5 pb-3">
                  <h2 className="text-xl font-bold text-white mb-1">{section.title}</h2>
                  <p className="text-sm text-gray-500 leading-relaxed">{section.description}</p>
                </div>
                {section.endpoints.map(ep => (
                  <EndpointCard key={ep.method + ep.path} ep={ep} apiKey={apiKey} onGotKey={k => setApiKey(k)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <PageFooter onGettingStarted={onGettingStarted} onPrivacy={onPrivacy} onTerms={onTerms} />
    </div>
  )
}
