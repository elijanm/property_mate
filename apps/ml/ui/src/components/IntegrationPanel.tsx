/**
 * IntegrationPanel — code snippets for every integration surface.
 *
 * Sections  → Sub-items
 * ─────────────────────
 * Web       → cURL · Python · JavaScript · PHP · .NET
 * SDK       → Python SDK · npm / JS · PHP
 * IoT       → Raspberry Pi · ESP32
 */
import { useState } from 'react'
import type { ModelDeployment } from '@/types/trainer'
import { Copy, Check, Globe, Package, Cpu, FileCode, Layers } from 'lucide-react'

interface Props {
  deployment: ModelDeployment
  /** input_schema from the trainer — used to decide file vs JSON examples */
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  /** full alias used in inference URL (e.g. "acme/my_model" or "iris_classifier") */
  alias?: string
  /** org slug prefix — shown as badge when trainer is org-owned */
  orgSlug?: string
}

// ── Section / tab config ──────────────────────────────────────────────────────

type SectionId = 'web' | 'sdk' | 'iot' | 'schema' | 'advanced'
type ItemId =
  | 'curl' | 'python_http' | 'javascript' | 'php_http' | 'dotnet'
  | 'sdk_python' | 'sdk_npm' | 'sdk_php'
  | 'raspberry' | 'esp32'
  | 'schema_input' | 'schema_output'
  | 'version_pinned' | 'best_metric' | 'all_versions'

interface NavSection {
  id: SectionId
  label: string
  icon: React.ReactNode
  items: { id: ItemId; label: string }[]
}

const NAV: NavSection[] = [
  {
    id: 'web', label: 'Web / HTTP', icon: <Globe size={14} />,
    items: [
      { id: 'curl',        label: 'cURL' },
      { id: 'python_http', label: 'Python' },
      { id: 'javascript',  label: 'JavaScript' },
      { id: 'php_http',    label: 'PHP' },
      { id: 'dotnet',      label: '.NET / C#' },
    ],
  },
  {
    id: 'sdk', label: 'SDK', icon: <Package size={14} />,
    items: [
      { id: 'sdk_python', label: 'Python SDK' },
      { id: 'sdk_npm',    label: 'npm / JS' },
      { id: 'sdk_php',    label: 'PHP SDK' },
    ],
  },
  {
    id: 'iot', label: 'IoT / Edge', icon: <Cpu size={14} />,
    items: [
      { id: 'raspberry', label: 'Raspberry Pi' },
      { id: 'esp32',     label: 'ESP32 (Arduino)' },
    ],
  },
  {
    id: 'schema' as SectionId, label: 'Schema', icon: <FileCode size={14} />,
    items: [
      { id: 'schema_input' as ItemId, label: 'Input Schema' },
      { id: 'schema_output' as ItemId, label: 'Output Schema' },
    ],
  },
  {
    id: 'advanced' as SectionId, label: 'Advanced', icon: <Layers size={14} />,
    items: [
      { id: 'version_pinned' as ItemId, label: 'Pin Version' },
      { id: 'best_metric' as ItemId,    label: 'Best Metric' },
      { id: 'all_versions' as ItemId,   label: 'All Versions' },
    ],
  },
]

// ── Snippet generators ────────────────────────────────────────────────────────

function apiBase(): string {
  return `${window.location.origin}/api/v1`
}

function hasFileInput(schema?: Record<string, unknown>): boolean {
  if (!schema) return true   // assume file by default (more interesting example)
  return Object.values(schema).some((v: unknown) => {
    const t = (v as Record<string, unknown>)?.type
    return t === 'file' || t === 'image' || t === 'video'
  })
}

function buildExampleInputsFromSchema(schema?: Record<string, unknown>): Record<string, unknown> {
  if (!schema) return {}
  const ex: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(schema)) {
    const field = f as Record<string, unknown>
    if (field.type === 'image' || field.type === 'file') continue  // skip binary
    if (field.example != null) ex[k] = field.example
    else if (field.default != null) ex[k] = field.default
    else if (field.type === 'number') ex[k] = field.min ?? 0
    else if (field.type === 'boolean') ex[k] = false
    else if (field.enum && (field.enum as string[]).length > 0) ex[k] = (field.enum as string[])[0]
    else ex[k] = `<${k}>`
  }
  return ex
}

function snippets(dep: ModelDeployment, schema?: Record<string, unknown>, alias?: string, orgSlug?: string): Record<ItemId, { lang: string; code: string }> {
  const base = apiBase()
  const name = alias || dep.trainer_name
  const endpoint = `${base}/inference/${name}`
  const uploadEndpoint = `${base}/inference/${name}/upload`
  const nsNote = orgSlug
    ? `# Org: ${orgSlug}  |  Trainer: ${name}\n`
    : ''
  const fileMode = hasFileInput(schema)
  const exampleInputs = buildExampleInputsFromSchema(schema)
  const jsonExample = JSON.stringify({ inputs: Object.keys(exampleInputs).length ? exampleInputs : { value: 42 } }, null, 2)

  return {
    // ── Web / HTTP ──────────────────────────────────────────────────────────
    curl: {
      lang: 'bash',
      code: fileMode ? `${nsNote}# ── File upload (image, video, document) ──────────────────────────
curl -X POST "${uploadEndpoint}" \\
  -H "X-Api-Key: <YOUR_API_KEY>" \\
  -F "file=@/path/to/your/file.jpg" \\
  -F "extra={}"

# ── JSON body (pass an image URL or other inputs) ───────────────
curl -X POST "${endpoint}" \\
  -H "X-Api-Key: <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"inputs": {"image_url": "https://example.com/image.jpg"}}'` :
`${nsNote}curl -X POST "${endpoint}" \\
  -H "X-Api-Key: <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '${jsonExample}'`,
    },

    python_http: {
      lang: 'python',
      code: fileMode ? `import requests

${nsNote}API_KEY = "<YOUR_API_KEY>"
BASE    = "${base}"
TRAINER = "${name}"
HEADERS = {"X-Api-Key": API_KEY}

# ── File upload ───────────────────────────────────────────
with open("image.jpg", "rb") as f:
    resp = requests.post(
        f"{BASE}/inference/{TRAINER}/upload",
        headers=HEADERS,
        files={"file": ("image.jpg", f, "image/jpeg")},
    )

print(resp.json())

# ── JSON body ─────────────────────────────────────────────
resp = requests.post(
    f"{BASE}/inference/{TRAINER}",
    headers={**HEADERS, "Content-Type": "application/json"},
    json={"inputs": {"image_url": "https://example.com/image.jpg"}},
)
print(resp.json())` :
`import requests

${nsNote}API_KEY = "<YOUR_API_KEY>"
BASE    = "${base}"
TRAINER = "${name}"

resp = requests.post(
    f"{BASE}/inference/{TRAINER}",
    headers={"X-Api-Key": API_KEY},
    json={"inputs": {"value": 42}},
)
print(resp.json())`,
    },

    javascript: {
      lang: 'javascript',
      code: fileMode ? `${nsNote}const API_KEY = "<YOUR_API_KEY>";
const BASE    = "${base}";
const TRAINER = "${name}";

// ── File upload (browser) ─────────────────────────────────
async function runFromFile(file) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(\`\${BASE}/inference/\${TRAINER}/upload\`, {
    method: "POST",
    headers: { "X-Api-Key": API_KEY },
    body: form,
  });
  return res.json();
}

// ── JSON body ─────────────────────────────────────────────
async function runFromUrl(imageUrl) {
  const res = await fetch(\`\${BASE}/inference/\${TRAINER}\`, {
    method: "POST",
    headers: {
      "X-Api-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: { image_url: imageUrl } }),
  });
  return res.json();
}

// Example usage
document.getElementById("fileInput").addEventListener("change", async (e) => {
  const result = await runFromFile(e.target.files[0]);
  console.log(result);
});` :
`${nsNote}const API_KEY = "<YOUR_API_KEY>";
const BASE    = "${base}";
const TRAINER = "${name}";

const res = await fetch(\`\${BASE}/inference/\${TRAINER}\`, {
  method: "POST",
  headers: {
    "X-Api-Key": API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ inputs: { value: 42 } }),
});
const result = await res.json();
console.log(result);`,
    },

    php_http: {
      lang: 'php',
      code: fileMode ? `<?php
${nsNote}$apiKey   = "<YOUR_API_KEY>";
$base     = "${base}";
$trainer  = "${name}";
$endpoint = "{$base}/inference/{$trainer}/upload";

$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL            => $endpoint,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => ["X-Api-Key: {$apiKey}"],
    CURLOPT_POSTFIELDS     => [
        "file" => new CURLFile("/path/to/image.jpg", "image/jpeg", "image.jpg"),
    ],
]);

$response = curl_exec($curl);
curl_close($curl);

$result = json_decode($response, true);
print_r($result);` :
`<?php
${nsNote}$apiKey   = "<YOUR_API_KEY>";
$base     = "${base}";
$trainer  = "${name}";
$endpoint = "{$base}/inference/{$trainer}";

$data = json_encode(["inputs" => ["value" => 42]]);

$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL            => $endpoint,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => [
        "X-Api-Key: {$apiKey}",
        "Content-Type: application/json",
    ],
    CURLOPT_POSTFIELDS     => $data,
]);

$response = curl_exec($curl);
curl_close($curl);

$result = json_decode($response, true);
print_r($result);`,
    },

    dotnet: {
      lang: 'csharp',
      code: fileMode ? `// ${nsNote.trim() || `Trainer: ${name}`}
using System.Net.Http;
using System.Net.Http.Headers;

var apiKey   = "<YOUR_API_KEY>";
var baseUrl  = "${base}";
var trainer  = "${name}";
var endpoint = $"{baseUrl}/inference/{trainer}/upload";

using var client = new HttpClient();
client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);

using var form    = new MultipartFormDataContent();
using var stream  = File.OpenRead("image.jpg");
var fileContent   = new StreamContent(stream);
fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
form.Add(fileContent, "file", "image.jpg");

var response = await client.PostAsync(endpoint, form);
var json     = await response.Content.ReadAsStringAsync();
Console.WriteLine(json);` :
`// ${nsNote.trim() || `Trainer: ${name}`}
using System.Net.Http;
using System.Net.Http.Json;

var apiKey   = "<YOUR_API_KEY>";
var baseUrl  = "${base}";
var trainer  = "${name}";
var endpoint = $"{baseUrl}/inference/{trainer}";

using var client = new HttpClient();
client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);

var payload  = new { inputs = new { value = 42 } };
var response = await client.PostAsJsonAsync(endpoint, payload);
var json     = await response.Content.ReadAsStringAsync();
Console.WriteLine(json);`,
    },

    // ── SDK ─────────────────────────────────────────────────────────────────
    sdk_python: {
      lang: 'python',
      code: `# pip install mldock-sdk
${nsNote}from mldock import MLDockClient

client = MLDockClient(
    base_url="${base}",
    api_key="<YOUR_API_KEY>",   # sent as X-Api-Key header
)

TRAINER = "${name}"

# Run inference
${fileMode ?
`result = client.predict(TRAINER, file="image.jpg")` :
`result = client.predict(TRAINER, inputs={"value": 42})`}
print(result)

# Stream results via SSE
for event in client.predict_stream(TRAINER, file="image.jpg"):
    print(event)

# List recent inferences
logs = client.inference_logs(TRAINER, limit=20)
for log in logs:
    print(log.id, log.predicted_label_hint)`,
    },

    sdk_npm: {
      lang: 'javascript',
      code: `// npm install @mldock/sdk
${nsNote}import { MLDockClient } from "@mldock/sdk";

const client = new MLDockClient({
  baseUrl: "${base}",
  apiKey: "<YOUR_API_KEY>",
});

const TRAINER = "${name}";

// Run inference
${fileMode ?
`// From a File object (browser)
const result = await client.predict(TRAINER, { file });

// From a file path (Node.js)
const result = await client.predict(TRAINER, { filePath: "./image.jpg" });` :
`const result = await client.predict(TRAINER, { inputs: { value: 42 } });`}
console.log(result);

// Submit feedback (drives confusion matrix)
await client.submitFeedback(TRAINER, {
  inferenceLogId: result.log_id,
  isCorrect: true,
  predictedLabel: result.prediction,
});`,
    },

    sdk_php: {
      lang: 'php',
      code: `<?php
// composer require mldock/sdk
${nsNote}require_once "vendor/autoload.php";

use MLDock\\Client;

$client = new Client([
    "base_url" => "${base}",
    "api_key"  => "<YOUR_API_KEY>",
]);

$trainer = "${name}";

// Run inference
${fileMode ?
`$result = $client->predict($trainer, ["file" => "/path/to/image.jpg"]);` :
`$result = $client->predict($trainer, ["inputs" => ["value" => 42]]);`}
var_dump($result);

// Submit feedback
$client->submitFeedback($trainer, [
    "inference_log_id" => $result["log_id"],
    "is_correct"       => true,
]);`,
    },

    // ── IoT ─────────────────────────────────────────────────────────────────
    raspberry: {
      lang: 'python',
      code: `#!/usr/bin/env python3
"""
Raspberry Pi — capture image from Pi Camera and run inference.
Requires: pip install picamera2 requests
"""
import io
import time
import requests
from picamera2 import Picamera2

${nsNote}API_KEY  = "<YOUR_API_KEY>"
BASE     = "${base}"
TRAINER  = "${name}"
ENDPOINT = f"{BASE}/inference/{TRAINER}/upload"

def capture_and_predict():
    cam = Picamera2()
    cam.configure(cam.create_still_configuration())
    cam.start()
    time.sleep(2)          # warm-up

    buf = io.BytesIO()
    cam.capture_file(buf, format="jpeg")
    buf.seek(0)
    cam.stop()

    resp = requests.post(
        ENDPOINT,
        headers={"X-Api-Key": API_KEY},
        files={"file": ("capture.jpg", buf, "image/jpeg")},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()

if __name__ == "__main__":
    while True:
        result = capture_and_predict()
        print("Prediction:", result)
        time.sleep(10)     # capture every 10 seconds`,
    },

    schema_input: { lang: 'json', code: '' },
    schema_output: { lang: 'json', code: '' },

    // ── Advanced ─────────────────────────────────────────────────────────────
    version_pinned: {
      lang: 'python',
      code: `import requests
${nsNote}
API_KEY = "<YOUR_API_KEY>"
BASE    = "${base}"
TRAINER = "${name}"

# Pin to a specific plugin_version + training_patch (e.g. v1.0.0.3)
resp = requests.post(
    f"{BASE}/inference/{TRAINER}",
    headers={"X-Api-Key": API_KEY},
    json={
        "inputs": ${JSON.stringify(Object.keys(exampleInputs).length ? exampleInputs : { value: 42 }, null, 8).replace(/\n/g, '\n        ')},
        "plugin_version": 1,   # plugin file generation
        "training_patch": 3,   # retraining ordinal (0 = first run)
        # "model_version": "5",  # alternatively target by MLflow version string
    },
)
print(resp.json())`,
    },

    best_metric: {
      lang: 'python',
      code: `import requests
${nsNote}
API_KEY = "<YOUR_API_KEY>"
BASE    = "${base}"
TRAINER = "${name}"

# Route to the deployment with the best accuracy
resp = requests.post(
    f"{BASE}/inference/{TRAINER}",
    headers={"X-Api-Key": API_KEY},
    json={
        "inputs": ${JSON.stringify(Object.keys(exampleInputs).length ? exampleInputs : { value: 42 }, null, 8).replace(/\n/g, '\n        ')},
        "best_metric": "accuracy",     # metric key to rank by
        "best_metric_mode": "max",     # "max" (default) or "min" for loss/error metrics
        # "best_metric": "loss",
        # "best_metric_mode": "min",
    },
)
print(resp.json())`,
    },

    all_versions: {
      lang: 'python',
      code: `import requests
${nsNote}
API_KEY = "<YOUR_API_KEY>"
BASE    = "${base}"
TRAINER = "${name}"

# Run inputs against ALL active deployments and compare results
resp = requests.post(
    f"{BASE}/inference/{TRAINER}/all-versions",
    headers={"X-Api-Key": API_KEY},
    json={
        "inputs": ${JSON.stringify(Object.keys(exampleInputs).length ? exampleInputs : { value: 42 }, null, 8).replace(/\n/g, '\n        ')},
    },
)
data = resp.json()
print(f"Ran against {data['total']} version(s)")

for v in data["results"]:
    tag = "DEFAULT" if v["is_default"] else "       "
    ver = v.get("version_full") or f"patch={v['training_patch']}"
    if v["error"]:
        print(f"  {tag}  {ver}  ERROR: {v['error']}")
    else:
        metrics = v.get("metrics", {})
        m = ", ".join(f"{k}={val:.3f}" for k, val in metrics.items()) if metrics else "—"
        print(f"  {tag}  {ver}  metrics=[{m}]  prediction={v['prediction']}")`,
    },

    esp32: {
      lang: 'cpp',
      code: `/*
 * ESP32-CAM — capture JPEG and POST to inference endpoint.
 * Board: AI Thinker ESP32-CAM
 * Libraries: ESP32 Arduino Core, ArduinoJson
 */
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"

const char* WIFI_SSID     = "YOUR_SSID";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* API_KEY       = "<YOUR_API_KEY>";
const char* BASE_URL      = "${base}";
// Trainer (namespaced): ${name}
const char* ENDPOINT      = "${uploadEndpoint}";

// AI-Thinker ESP32-CAM pin map
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM; config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM; config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM; config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM; config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk  = XCLK_GPIO_NUM; config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM; config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM; config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn  = PWDN_GPIO_NUM;  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_VGA;
  config.jpeg_quality = 12;
  config.fb_count     = 1;
  esp_camera_init(&config);
}

void sendFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("Camera capture failed"); return; }

  HTTPClient http;
  http.begin(ENDPOINT);
  http.addHeader("X-Api-Key", API_KEY);

  // Build multipart body manually
  String boundary = "----ESP32Boundary";
  String bodyStart = "--" + boundary + "\\r\\n"
    "Content-Disposition: form-data; name=\\"file\\"; filename=\\"frame.jpg\\"\\r\\n"
    "Content-Type: image/jpeg\\r\\n\\r\\n";
  String bodyEnd = "\\r\\n--" + boundary + "--\\r\\n";

  int totalLen = bodyStart.length() + fb->len + bodyEnd.length();
  http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
  http.addHeader("Content-Length", String(totalLen));

  // Stream body
  WiFiClient* stream = http.getStreamPtr();
  stream->print(bodyStart);
  stream->write(fb->buf, fb->len);
  stream->print(bodyEnd);

  int code = http.POST((uint8_t*)NULL, 0);
  if (code == HTTP_CODE_OK || code == 201) {
    Serial.println("Response: " + http.getString());
  } else {
    Serial.printf("HTTP error: %d\\n", code);
  }
  http.end();
  esp_camera_fb_return(fb);
}

void setup() {
  Serial.begin(115200);
  initCamera();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\\nWiFi connected: " + WiFi.localIP().toString());
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) sendFrame();
  delay(10000);   // every 10 seconds
}`,
    },
  }
}

// ── Syntax highlight (minimal — colourises keywords by language) ──────────────

const KEYWORD_COLORS: Record<string, { keywords: RegExp; strings: RegExp; comments: RegExp }> = {
  bash:       { keywords: /\b(curl|export|echo|if|fi|then|else)\b/g, strings: /"[^"]*"/g, comments: /#.*/g },
  python:     { keywords: /\b(import|from|def|class|return|if|else|elif|for|while|with|as|in|and|or|not|True|False|None|print|async|await)\b/g, strings: /("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"]*"|'[^']*')/g, comments: /#.*/g },
  javascript: { keywords: /\b(const|let|var|async|await|function|return|if|else|for|while|new|import|export|from|of|true|false|null|undefined|console)\b/g, strings: /(`[^`]*`|"[^"]*"|'[^']*')/g, comments: /\/\/.*/g },
  php:        { keywords: /\b(require_once|use|new|echo|if|else|foreach|return|function|class|namespace|true|false|null|var_dump|print_r)\b/g, strings: /"[^"]*"|'[^']*'/g, comments: /\/\/.*/g },
  csharp:     { keywords: /\b(using|var|new|await|async|string|int|bool|void|class|namespace|return|true|false|null|public|private|static)\b/g, strings: /"[^"]*"/g, comments: /\/\/.*/g },
  cpp:        { keywords: /\b(include|define|void|int|bool|const|char|float|if|else|while|return|new|delete|nullptr|true|false|String|Serial|WiFi|delay|setup|loop)\b/g, strings: /"[^"]*"/g, comments: /\/\/.*/g },
}

function highlight(code: string, lang: string): string {
  const rules = KEYWORD_COLORS[lang]
  if (!rules) return escapeHtml(code)

  // Single-pass tokeniser: build one combined regex (comments first = highest priority)
  // so each character is matched exactly once and spans are never re-scanned.
  const combined = new RegExp(
    `(${rules.comments.source})|(${rules.strings.source})|(${rules.keywords.source})`,
    'gm',
  )

  let result = ''
  let last = 0
  let m: RegExpExecArray | null

  while ((m = combined.exec(code)) !== null) {
    result += escapeHtml(code.slice(last, m.index))
    last = m.index + m[0].length
    const [, comment, str, keyword] = m
    if (comment !== undefined) {
      result += `<span class="text-gray-500 italic">${escapeHtml(comment)}</span>`
    } else if (str !== undefined) {
      result += `<span class="text-amber-400">${escapeHtml(str)}</span>`
    } else if (keyword !== undefined) {
      result += `<span class="text-brand-400 font-semibold">${escapeHtml(keyword)}</span>`
    }
  }

  result += escapeHtml(code.slice(last))
  return result
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IntegrationPanel({ deployment, inputSchema, outputSchema, alias, orgSlug }: Props) {
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set(['web']))
  const [selectedItem, setSelectedItem] = useState<ItemId>('curl')
  const [copied, setCopied] = useState(false)

  const isSchemaItem = selectedItem === 'schema_input' || selectedItem === 'schema_output'
  const allSnippets = snippets(deployment, inputSchema, alias, orgSlug)
  const current = isSchemaItem ? { lang: 'json', code: '' } : allSnippets[selectedItem]

  function toggleSection(id: SectionId) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copy() {
    await navigator.clipboard.writeText(current.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* ── Side nav ─────────────────────────────────────────────────────── */}
      <div className="w-44 shrink-0 border-r border-gray-800 overflow-y-auto py-2">
        {NAV.map(section => (
          <div key={section.id}>
            {/* Section header */}
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-400 hover:text-gray-200 uppercase tracking-wider"
            >
              {section.icon}
              {section.label}
              <svg
                className={`ml-auto w-3 h-3 transition-transform ${openSections.has(section.id) ? 'rotate-180' : ''}`}
                viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
              >
                <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Sub-items */}
            {openSections.has(section.id) && (
              <div className="mb-1">
                {section.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item.id)}
                    className={`w-full text-left px-5 py-1.5 text-xs transition-colors rounded-r-xl mr-1 ${
                      selectedItem === item.id
                        ? 'bg-brand-600/20 text-brand-400 font-semibold border-l-2 border-brand-500'
                        : 'text-gray-500 hover:text-gray-300 border-l-2 border-transparent'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Code panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-gray-400">
              POST {apiBase()}/inference/
              {orgSlug && <span className="text-indigo-400">{orgSlug}/</span>}
              <span className="text-brand-400">{deployment.trainer_name}</span>
            </span>
            {orgSlug && (
              <span className="px-1.5 py-0.5 text-[10px] bg-indigo-900/40 border border-indigo-700/40 rounded text-indigo-300 font-mono">
                org: {orgSlug}
              </span>
            )}
            {!isSchemaItem && (
              <span className="px-1.5 py-0.5 text-[10px] bg-gray-800 rounded text-gray-500 font-mono">
                {current.lang}
              </span>
            )}
          </div>
          {!isSchemaItem && (
            <button
              onClick={copy}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        {/* Code block or Schema table */}
        <div className="flex-1 overflow-auto">
          {isSchemaItem ? (
            <div className="p-5">
              {(() => {
                const schema = selectedItem === 'schema_input' ? inputSchema : outputSchema
                if (!schema || Object.keys(schema).length === 0) {
                  return <p className="text-xs text-gray-600 text-center py-10">No schema defined for this model.</p>
                }
                return (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-800/50 border-b border-gray-800">
                          {['Field', 'Type', 'Required', 'Unit', 'Description'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {Object.entries(schema).map(([k, f]) => {
                          const field = f as Record<string, unknown>
                          return (
                            <tr key={k}>
                              <td className="px-4 py-2.5 font-mono text-brand-400">{k}</td>
                              <td className="px-4 py-2.5 text-gray-400 font-mono">{String(field.type ?? 'string')}</td>
                              <td className="px-4 py-2.5">{field.required ? <span className="text-red-400">required</span> : <span className="text-gray-600">optional</span>}</td>
                              <td className="px-4 py-2.5 text-gray-500">{field.unit ? String(field.unit) : '—'}</td>
                              <td className="px-4 py-2.5 text-gray-500">{String(field.description ?? field.label ?? '')}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </div>
          ) : (
            <pre
              className="p-5 text-xs font-mono text-gray-300 leading-relaxed min-h-full"
              dangerouslySetInnerHTML={{ __html: highlight(current.code, current.lang) }}
            />
          )}
        </div>

        {/* Footer tip */}
        <div className="px-4 py-2.5 border-t border-gray-800 shrink-0">
          <p className="text-[10px] text-gray-600 space-x-2">
            <span>Replace <span className="text-amber-400/70 font-mono">&lt;YOUR_API_KEY&gt;</span> with a key from <span className="text-gray-500">Settings → API Keys</span> (header: <span className="font-mono text-gray-500">X-Api-Key</span>).</span>
            {orgSlug && (
              <span>Org slug: <span className="font-mono text-indigo-400/70">{orgSlug}</span></span>
            )}
            <span>v{deployment.mlflow_model_version ?? deployment.version}.</span>
          </p>
        </div>
      </div>
    </div>
  )
}
