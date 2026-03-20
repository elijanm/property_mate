# Photo Consent Flow

Mldock supports capturing signed photo/data consent from subjects before any images are collected. When enabled on a dataset, the collector **cannot submit any entries** until at least one consent record has been created and signed.

---

## Enabling Consent on a Dataset

1. Open the dataset in the admin UI → **Settings** tab → **Consent** section.
2. Toggle **Require Photo Consent** on.
3. Choose **Consent Type**:
   - `individual` — one consent record per subject (default)
   - `group` — one consent record covers a group, signed by an authorised representative
4. Optionally select a **Consent Template** (if none selected, the platform default is used).
5. Save. The change takes effect immediately for any new collect-page sessions.

---

## Collector Experience

### Loading order on `/collect/{token}`

```
1. Location prompt        (if require_location = true)
2. ── locationResolved ──
3. Consent panel          (if require_consent = true)   ← blocks everything below
4. Field cards            (hidden until ≥ 1 consent record exists)
```

### Consent Panel

When `require_consent` is `true` and no consent records exist yet, the collector sees:

```
┌─────────────────────────────────────────────────────┐
│  ⚠  Photo Consent Required                          │
│  Capture signed consent before taking photos        │
│                                [+ Add Consent]      │
└─────────────────────────────────────────────────────┘
```

The **Add Consent** button opens the ConsentModal. Field cards are hidden until at least one consent record is completed.

Once one or more records exist, the panel shows chips for each subject:

```
  ✓ John Doe (complete)   ✓ Jane Smith (complete)   [+ Add]
  Active: John Doe  ▼
```

The collector can switch the **active consent record** — all subsequent entry submissions are linked to the active record.

---

## ConsentModal — Step-by-Step

### Step 1 — Details

| Field | Notes |
|---|---|
| Subject Name | Required — appears in the rendered consent body |
| Subject Email | Optional — if provided, an email signing link is sent |
| Representative Name | Required for group consent only |

### Step 2 — Signing Method

| Method | Description |
|---|---|
| **On-screen** | Subject signs digitally on a canvas pad |
| **Offline / Paper** | Collector photographs the signed paper form |

### Step 3 — Read Agreement

The rendered consent agreement is shown in full before any signature is captured. Template placeholders (`{{subject_name}}`, `{{org_name}}`, `{{dataset_name}}`, `{{collector_name}}`, `{{date}}`) are filled in with actual values.

### Step 4 — Subject Signs

Canvas signature pad. Subject draws their signature. Tapping **Continue** records the signature as a base64 PNG.

*For offline method:* Collector uploads a photo of the paper form instead.

### Step 5 — Collector Signs

Collector adds their own signature to complete the two-party agreement.

### Step 6 — Done

- `ConsentRecord.status` → `complete`
- A signed PDF is generated and stored to S3 at `{org_id}/consents/{dataset_id}/{record_id}.pdf`
- The record token is set as the active consent token for the session
- Field cards are now visible

---

## Email Signing

If the subject's email is provided during initiation:

1. An email is sent with a link to `/consent-sign/{email_token}`
2. The subject opens the link on their own device
3. They read the agreement and draw their signature
4. Status updates to `subject_signed`
5. The collector then completes their own signature via the in-app flow

The collector can proceed to collect data while waiting for the email signing to complete — entries are still linked to the pending consent record.

---

## Data Model

### ConsentRecord

| Field | Type | Description |
|---|---|---|
| `token` | string | Public access token — passed as `consent_record_id` on every entry |
| `status` | string | `pending` → `subject_signed` → `complete` / `void` |
| `subject_name` | string | Name of the photographed subject |
| `subject_email` | string? | Email for remote signing link |
| `subject_signature` | object? | `{signature_data, signer_name, signed_at, ip}` |
| `collector_signature` | object? | Same structure |
| `pdf_key` | string? | S3 key of the generated signed PDF |
| `offline_photo_key` | string? | S3 key of the paper form photo |
| `entry_ids` | string[] | IDs of DatasetEntry records covered by this consent |
| `consent_type` | string | `individual` \| `group` |

### DatasetEntry

Each submitted entry carries `consent_record_id` (the `ConsentRecord.token`) linking it to the consent that authorises collection.

---

## Consent Templates

Templates use plain text with `{{placeholders}}`:

| Placeholder | Replaced with |
|---|---|
| `{{subject_name}}` | Subject's full name |
| `{{representative_name}}` | Group representative name |
| `{{org_name}}` | Organisation name |
| `{{collector_name}}` | Collector's name |
| `{{dataset_name}}` | Dataset name |
| `{{date}}` | Today's date |

Org admins can create custom templates under **Settings → Consent Templates**. If no template is assigned to the dataset, the platform global default is used.

### Default Individual Template

```
PHOTOGRAPHY CONSENT AGREEMENT

I, {{subject_name}}, hereby grant {{org_name}} and its authorised representatives
permission to photograph me for the purpose of dataset collection for machine
learning research and development.

I understand that:
1. My image may be used in training datasets.
2. My personal information will be protected in accordance with applicable data
   protection laws.
3. I may withdraw this consent at any time by contacting the data collector.

Collector: {{collector_name}}
Dataset:   {{dataset_name}}
Date:      {{date}}
```

---

## API Endpoints (Public — no auth)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/consent/initiate/{collect_token}` | Start a new consent session |
| `GET` | `/api/v1/consent/sign/{record_token}` | Get consent record for signing |
| `POST` | `/api/v1/consent/sign/{record_token}` | Sign as subject or collector (`role` param) |
| `POST` | `/api/v1/consent/sign/{record_token}/offline-photo` | Upload paper form photo |
| `GET` | `/api/v1/consent/email-sign/{email_token}` | Get record via email token |
| `POST` | `/api/v1/consent/email-sign/{email_token}` | Sign via email link |

---

## Known Bug Fix (2026-03-20)

**Symptom:** Enabling `require_consent` on a dataset had no effect on the collector page — the consent panel never appeared even after saving the setting.

**Root cause:** `get_form_definition()` in `dataset_service.py` was not including `require_consent`, `consent_template_id`, or `consent_type` in the form response sent to the collector. The frontend received `require_consent: undefined` which is falsy, so the panel was never rendered.

**Fix:** Added the three fields to the `dataset` dict in `get_form_definition()`:

```python
"require_consent": profile.require_consent,
"consent_template_id": profile.consent_template_id,
"consent_type": profile.consent_type,
```
