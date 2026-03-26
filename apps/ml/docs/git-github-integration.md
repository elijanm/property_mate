# Git & GitHub Integration

## Overview

The ML service supports two GitHub OAuth flows:

| Flow | Purpose | Callback URL |
|------|---------|--------------|
| **Sign in / Sign up with GitHub** | Create or log into an MLDock account using GitHub identity | `/oauth/callback/github` |
| **Connect GitHub to existing account** | Link a GitHub account to an already-authenticated email/password account (enables repo listing + cloning) | `/oauth/callback/github-connect` |

Both flows use the same GitHub OAuth App — they differ only in the redirect URI and the backend endpoint they call after exchanging the code.

---

## GitHub OAuth App Setup

### 1. Create a GitHub OAuth App

Go to: **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**

Fill in:

| Field | Value |
|-------|-------|
| Application name | `MLDock` (or your app name) |
| Homepage URL | `https://your-domain.com` (or `http://localhost:5200` for dev) |
| Authorization callback URL | See table below |

### 2. Callback URLs to Register

GitHub only accepts one callback URL per OAuth App. Use a wildcard-compatible base path, or create two separate OAuth Apps (one per environment).

**Recommended**: Register the production callback and rely on the `redirect_uri` parameter to route traffic:

```
https://your-domain.com/oauth/callback/github
```

GitHub validates that the `redirect_uri` in the authorization request **starts with** the registered callback URL, so both callback paths below will be accepted as long as your registered URL is a prefix:

| Environment | Sign-in callback | Connect callback |
|-------------|-----------------|-----------------|
| **Production** | `https://your-domain.com/oauth/callback/github` | `https://your-domain.com/oauth/callback/github-connect` |
| **Development** | `http://localhost:5200/oauth/callback/github` | `http://localhost:5200/oauth/callback/github-connect` |

> **Important**: GitHub requires the registered callback URL to be a prefix of the `redirect_uri` sent in the authorization request. Registering `https://your-domain.com/oauth/callback/github` covers both `/oauth/callback/github` and `/oauth/callback/github-connect`.

If GitHub rejects the connect callback, register a second OAuth App specifically for the connect flow and set `GITHUB_CONNECT_CLIENT_ID` / `GITHUB_CONNECT_CLIENT_SECRET` separately, or re-use the same app and register both paths explicitly.

### 3. Set Environment Variables

```env
GITHUB_CLIENT_ID=<your-oauth-app-client-id>
GITHUB_CLIENT_SECRET=<your-oauth-app-client-secret>
```

These go in `apps/ml/.env` (or in docker-compose / Kubernetes secrets).

---

## OAuth Scope

The GitHub OAuth App requests the following scopes:

```
read:user  user:email  repo
```

| Scope | Why |
|-------|-----|
| `read:user` | Read the user's GitHub profile (name, avatar) |
| `user:email` | Read the user's verified email address |
| `repo` | List and clone repositories (public **and** private) |

If you only need access to public repos, change `repo` to `public_repo` in `apps/ml/app/api/v1/auth.py`:

```python
"scope": "read:user user:email public_repo",
```

---

## Backend Endpoints

### GET `/api/v1/auth/oauth/github/url`

Returns the GitHub authorization URL.

**Query params**

| Param | Required | Description |
|-------|----------|-------------|
| `redirect_uri` | yes | One of the callback URLs above |

**Response**
```json
{ "url": "https://github.com/login/oauth/authorize?...", "state": "<random>" }
```

---

### POST `/api/v1/auth/oauth/github/exchange`

**Sign in / Sign up flow.** Exchange the authorization code for MLDock tokens.
Called by the frontend after GitHub redirects to `/oauth/callback/github`.

**Body**
```json
{
  "code": "<code from GitHub>",
  "redirect_uri": "https://your-domain.com/oauth/callback/github"
}
```

**Response** — same shape as `/auth/login`:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "bearer",
  "user": { "email": "...", "full_name": "...", "role": "...", "org_id": "...", "is_onboarded": false, "github_connected": true }
}
```

---

### POST `/api/v1/auth/github/connect`

**Connect flow.** Link GitHub to an already-authenticated account.
Called by the frontend after GitHub redirects to `/oauth/callback/github-connect`.
Requires a valid `Authorization: Bearer <token>` header.

**Body**
```json
{
  "code": "<code from GitHub>",
  "redirect_uri": "https://your-domain.com/oauth/callback/github-connect"
}
```

**Response**
```json
{ "ok": true, "github_connected": true }
```

---

### DELETE `/api/v1/auth/github/disconnect`

Remove the stored GitHub token from the current account. Requires auth.

**Response**
```json
{ "ok": true, "github_connected": false }
```

---

### GET `/api/v1/auth/github/repos`

List the authenticated user's GitHub repositories with ML project detection.
Requires auth + GitHub connected.

**Query params**

| Param | Default | Description |
|-------|---------|-------------|
| `page` | 1 | Page number |
| `per_page` | 30 | Results per page (max 100) |

**Response**
```json
{
  "repos": [
    {
      "id": 123456,
      "name": "my-model",
      "full_name": "alice/my-model",
      "description": "A PyTorch image classifier",
      "html_url": "https://github.com/alice/my-model",
      "clone_url": "https://github.com/alice/my-model.git",
      "default_branch": "main",
      "language": "Python",
      "topics": ["pytorch", "machine-learning"],
      "private": false,
      "updated_at": "2026-03-24T10:00:00Z",
      "stargazers_count": 12,
      "is_ml_project": true
    }
  ],
  "page": 1,
  "per_page": 30,
  "total": 1
}
```

**ML detection heuristics** (`is_ml_project: true` if any of):
- Repo topics include: `machine-learning`, `deep-learning`, `pytorch`, `tensorflow`, `scikit-learn`, `nlp`, `computer-vision`, `ai`, `ml`, etc.
- Language is `Jupyter Notebook`
- Description contains: `machine learning`, `deep learning`, `neural`, `model`, `train`, `pytorch`, `tensorflow`

---

## Git Workspace Endpoints

All endpoints require `Authorization: Bearer <token>` and `engineer` or `admin` role (except `GET` endpoints which accept any authenticated user).

Base path: `/api/v1/git`

### POST `/git/clone`

Clone a GitHub repo into the editor workspace at `trainers/projects/<name>/`.

```json
{
  "clone_url": "https://github.com/alice/my-model.git",
  "project_name": "my-model",   // optional — defaults to repo name
  "branch": "main"              // optional — defaults to default branch
}
```

**Response**
```json
{
  "ok": true,
  "project_name": "my-model",
  "project_path": "projects/my-model",
  "ml_files": ["train.py", "requirements.txt"],
  "has_base_trainer": false,
  "has_notebooks": false,
  "has_requirements": true,
  "is_ml_project": true
}
```

---

### GET `/git/status?project_name=<name>`

```json
{
  "branch": "main",
  "changed": [
    { "status": "M", "path": "trainer.py" },
    { "status": "??", "path": "output/" }
  ],
  "clean": false,
  "remote_url": "https://github.com/alice/my-model.git"
}
```

---

### POST `/git/commit`

Stage all changes and create a commit.

```json
{
  "project_name": "my-model",
  "message": "Add preprocessing step",
  "author_name": "Alice",       // optional — defaults to MLDock user name
  "author_email": "alice@example.com"  // optional — defaults to MLDock email
}
```

**Response**
```json
{ "ok": true, "sha": "a1b2c3d...", "message": "Add preprocessing step" }
```

---

### POST `/git/push`

Push commits to the remote using the stored GitHub token.

```json
{
  "project_name": "my-model",
  "remote": "origin",   // optional, default "origin"
  "branch": ""          // optional — defaults to current branch
}
```

**Response**
```json
{ "ok": true, "output": "Branch 'main' set up to track remote branch 'main' from 'origin'." }
```

> The GitHub token is injected into the remote URL temporarily and removed after the push. It is never written to disk or exposed in logs.

---

### POST `/git/init`

Initialise a git repository in an existing project directory (or create a new one).

```json
{
  "project_name": "new-trainer",
  "remote_url": "https://github.com/alice/new-trainer.git",  // optional
  "default_branch": "main"
}
```

---

### POST `/git/create-repo`

Create a new GitHub repository via the GitHub API.

```json
{
  "name": "new-trainer",
  "description": "My MLDock neuron",
  "private": true
}
```

**Response**
```json
{
  "ok": true,
  "name": "new-trainer",
  "full_name": "alice/new-trainer",
  "clone_url": "https://github.com/alice/new-trainer.git",
  "html_url": "https://github.com/alice/new-trainer",
  "private": true
}
```

---

### GET `/git/log?project_name=<name>&limit=20`

```json
{
  "commits": [
    {
      "sha": "a1b2c3d4e5f6...",
      "author": "Alice",
      "author_email": "alice@example.com",
      "date": "2026-03-24T10:30:00+03:00",
      "message": "Add preprocessing step"
    }
  ]
}
```

---

### GET `/git/projects`

List all cloned/initialised projects in the workspace.

```json
{
  "projects": [
    { "name": "my-model", "path": "projects/my-model", "is_git": true },
    { "name": "scratch", "path": "projects/scratch", "is_git": false }
  ]
}
```

---

## Frontend Flow

### Sign in / Sign up with GitHub

```
User clicks "Sign in with GitHub"
  → GET /api/v1/auth/oauth/github/url?redirect_uri=<origin>/oauth/callback/github
  → Browser redirected to github.com with scope: read:user user:email repo
  → GitHub redirects back to /oauth/callback/github?code=<code>
  → OAuthCallbackPage calls POST /api/v1/auth/oauth/github/exchange
  → Tokens stored in localStorage → user logged in
```

### Connect GitHub to existing account

```
User opens Profile → "Connect GitHub"
  → GET /api/v1/auth/oauth/github/url?redirect_uri=<origin>/oauth/callback/github-connect
  → Browser redirected to github.com
  → GitHub redirects back to /oauth/callback/github-connect?code=<code>
  → GitHubConnectCallbackPage calls POST /api/v1/auth/github/connect (with Bearer token)
  → github_connected: true on user record
```

> **Note**: The frontend route `/oauth/callback/github-connect` must be added to `App.tsx` — see the "GitHub Connect Callback Page" section below.

### Import repo from editor

```
Editor → Git tab → "Import" button
  → GitHubReposModal opens
  → GET /api/v1/auth/github/repos  (lists repos, annotates is_ml_project)
  → User clicks "Clone"
  → POST /api/v1/git/clone { clone_url, project_name }
  → Modal closes, Git tab shows project status
```

### Commit & Push from editor

```
Editor → Git tab → select project
  → GitPanel shows branch, changed files
  → User types commit message → "Commit"
  → POST /api/v1/git/commit
  → User clicks "Push"
  → POST /api/v1/git/push  (token injected server-side)
```

---

## Adding the GitHub Connect Callback Route

The "Connect GitHub" flow redirects to `/oauth/callback/github-connect`. Add this route to `App.tsx`:

```tsx
// In App.tsx, alongside the existing oauth callback check:
const oauthCallbackMatch = window.location.pathname.match(/\/oauth\/callback\/(google|github)/)
if (oauthCallbackMatch) {
  return <OAuthCallbackPage provider={oauthCallbackMatch[1] as 'google' | 'github'} />
}

// GitHub connect callback (linking to existing account)
if (window.location.pathname === '/oauth/callback/github-connect') {
  return <GitHubConnectCallbackPage />
}
```

`GitHubConnectCallbackPage` reads `?code=` from the URL, calls `gitApi.connectGitHub(code, redirectUri)` with the current bearer token, then redirects back to the settings/profile page.

---

## Security Notes

- GitHub tokens are stored encrypted-at-rest via MongoDB (consider adding field-level encryption for production).
- Tokens are **never** logged or returned in API responses — `_user_dict()` only exposes `github_connected: boolean`.
- On push, the token is embedded into the remote URL in-memory, used, then immediately replaced with the clean (token-free) URL. The token is never written to `.git/config`.
- If the stored token is revoked (GitHub returns 401), it is automatically cleared from the user record and the user is prompted to reconnect.
- The `repo` scope grants access to private repositories. If your use case only needs public repos, use `public_repo` instead (change in `auth.py`).
