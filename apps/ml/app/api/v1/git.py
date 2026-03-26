"""
Git integration for the ML code editor.

Endpoints:
  POST /git/clone          — clone a GitHub repo into the user workspace
  GET  /git/status         — git status of a workspace subdirectory
  POST /git/commit         — stage all changes + commit
  POST /git/push           — push to remote using stored GitHub token
  POST /git/init           — git init + set remote for a new project
  POST /git/create-repo    — create a new GitHub repo via API
  GET  /git/log            — recent commits
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse, urlunparse

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.dependencies.auth import get_current_user, require_roles

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/git", tags=["git"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _plugin_dir() -> Path:
    p = Path(settings.TRAINER_PLUGIN_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _workspace_root() -> Path:
    """Root directory where cloned/imported repos live."""
    p = _plugin_dir() / "projects"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_project_path(project_name: str) -> Path:
    """Return path for a project dir; reject traversal."""
    # Strip any path separators
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", project_name)[:80]
    base = _workspace_root()
    full = (base / safe).resolve()
    if not str(full).startswith(str(base.resolve()) + os.sep) and full != base.resolve():
        raise HTTPException(status_code=400, detail="Invalid project name")
    return full


def _inject_token_into_url(clone_url: str, token: str) -> str:
    """Rewrite https clone URL to embed the OAuth token as Basic Auth."""
    parsed = urlparse(clone_url)
    # Replace the netloc to include token
    netloc = f"x-oauth-basic:{token}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


async def _run_git(args: List[str], cwd: Path, env: dict | None = None) -> tuple[int, str, str]:
    """Run a git command; return (returncode, stdout, stderr)."""
    git_env = {**os.environ}
    # Prevent git from prompting for credentials
    git_env["GIT_TERMINAL_PROMPT"] = "0"
    git_env["GIT_ASKPASS"] = "echo"
    if env:
        git_env.update(env)

    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=git_env,
    )
    stdout_b, stderr_b = await proc.communicate()
    return proc.returncode, stdout_b.decode(errors="replace"), stderr_b.decode(errors="replace")


def _ml_file_indicators(project_path: Path) -> dict:
    """Scan a cloned directory for ML project indicators."""
    ml_files: List[str] = []
    has_base_trainer = False
    has_notebooks = False
    has_requirements = False

    ml_patterns = {
        "torch", "tensorflow", "keras", "sklearn", "scikit-learn",
        "transformers", "xgboost", "lightgbm", "BaseTrainer",
    }

    for item in project_path.rglob("*"):
        if not item.is_file():
            continue
        rel = str(item.relative_to(project_path))
        # Skip hidden and pycache
        if any(part.startswith(".") or part == "__pycache__" for part in item.parts):
            continue
        if item.suffix == ".ipynb":
            has_notebooks = True
            ml_files.append(rel)
        if item.name in ("requirements.txt", "setup.py", "pyproject.toml", "environment.yml"):
            has_requirements = True
            ml_files.append(rel)
        if item.suffix == ".py" and item.stat().st_size < 200_000:
            try:
                text = item.read_text(errors="ignore")
                if "BaseTrainer" in text:
                    has_base_trainer = True
                    ml_files.append(rel)
                elif any(kw in text for kw in ml_patterns):
                    ml_files.append(rel)
            except Exception:
                pass
        if item.suffix in (".pt", ".pth", ".pkl", ".h5", ".onnx", ".pb"):
            ml_files.append(rel)

    return {
        "ml_files": list(set(ml_files))[:20],
        "has_base_trainer": has_base_trainer,
        "has_notebooks": has_notebooks,
        "has_requirements": has_requirements,
        "is_ml_project": bool(ml_files),
    }


# ── Clone ─────────────────────────────────────────────────────────────────────

class CloneRequest(BaseModel):
    clone_url: str          # https git URL
    project_name: str = ""  # optional override; defaults to repo name
    branch: str = ""        # optional branch to checkout


@router.post("/clone")
async def clone_repo(body: CloneRequest, user=Depends(require_roles("engineer", "admin"))):
    """Clone a GitHub repo into the user workspace."""
    if not user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub not connected")

    # Derive project name from URL if not provided
    name = body.project_name.strip() or Path(urlparse(body.clone_url).path).stem
    project_path = _safe_project_path(name)

    if project_path.exists():
        raise HTTPException(status_code=409, detail=f"Project '{name}' already exists in workspace")

    # Embed token into URL for auth
    auth_url = _inject_token_into_url(body.clone_url, user.github_access_token)

    clone_args = ["clone", "--depth", "50", auth_url, str(project_path)]
    if body.branch:
        clone_args = ["clone", "--depth", "50", "--branch", body.branch, auth_url, str(project_path)]

    logger.info("git_clone_started", project=name, user=user.email)
    rc, stdout, stderr = await _run_git(clone_args, _workspace_root())

    if rc != 0:
        # Clean up partial clone
        if project_path.exists():
            shutil.rmtree(project_path, ignore_errors=True)
        logger.error("git_clone_failed", project=name, error=stderr)
        raise HTTPException(status_code=400, detail=f"Clone failed: {stderr[:500]}")

    # Scan for ML content
    indicators = _ml_file_indicators(project_path)
    logger.info("git_clone_done", project=name, is_ml=indicators["is_ml_project"])

    return {
        "ok": True,
        "project_name": name,
        "project_path": f"projects/{name}",
        **indicators,
    }


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def git_status(project_name: str, user=Depends(get_current_user)):
    """Return git status for a workspace project."""
    project_path = _safe_project_path(project_name)
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    rc, stdout, stderr = await _run_git(["status", "--porcelain", "-b"], project_path)
    if rc != 0:
        raise HTTPException(status_code=400, detail=stderr[:300])

    lines = stdout.strip().splitlines()
    branch_line = lines[0] if lines else ""
    branch = branch_line.lstrip("# ").split("...")[0].replace("## ", "") if branch_line.startswith("##") else "unknown"

    changed = []
    for line in lines[1:]:
        if len(line) >= 3:
            xy = line[:2]
            path = line[3:]
            changed.append({"status": xy.strip(), "path": path})

    # Remote URL (strip token)
    rc2, remote_out, _ = await _run_git(["remote", "get-url", "origin"], project_path)
    remote_url = ""
    if rc2 == 0:
        raw = remote_out.strip()
        # Mask embedded token
        remote_url = re.sub(r"://[^@]+@", "://", raw)

    return {
        "branch": branch,
        "changed": changed,
        "clean": len(changed) == 0,
        "remote_url": remote_url,
    }


# ── Commit ────────────────────────────────────────────────────────────────────

class CommitRequest(BaseModel):
    project_name: str
    message: str
    author_name: str = ""
    author_email: str = ""


@router.post("/commit")
async def git_commit(body: CommitRequest, user=Depends(require_roles("engineer", "admin"))):
    """Stage all changes and create a commit."""
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Commit message is required")

    project_path = _safe_project_path(body.project_name)
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    name = body.author_name.strip() or user.full_name or user.email
    email = body.author_email.strip() or user.email

    env = {
        "GIT_AUTHOR_NAME": name,
        "GIT_AUTHOR_EMAIL": email,
        "GIT_COMMITTER_NAME": name,
        "GIT_COMMITTER_EMAIL": email,
    }

    # Stage all
    rc, _, err = await _run_git(["add", "-A"], project_path, env=env)
    if rc != 0:
        raise HTTPException(status_code=400, detail=f"git add failed: {err[:200]}")

    # Commit
    rc, stdout, stderr = await _run_git(["commit", "-m", body.message], project_path, env=env)
    if rc != 0:
        if "nothing to commit" in stderr or "nothing to commit" in stdout:
            return {"ok": True, "sha": None, "message": "Nothing to commit"}
        raise HTTPException(status_code=400, detail=f"git commit failed: {stderr[:200]}")

    # Get the new SHA
    rc2, sha_out, _ = await _run_git(["rev-parse", "HEAD"], project_path)
    sha = sha_out.strip() if rc2 == 0 else ""

    logger.info("git_committed", project=body.project_name, sha=sha[:8], user=user.email)
    return {"ok": True, "sha": sha, "message": body.message}


# ── Push ──────────────────────────────────────────────────────────────────────

class PushRequest(BaseModel):
    project_name: str
    remote: str = "origin"
    branch: str = ""   # defaults to current branch


@router.post("/push")
async def git_push(body: PushRequest, user=Depends(require_roles("engineer", "admin"))):
    """Push commits to the remote using the stored GitHub token."""
    if not user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub not connected")

    project_path = _safe_project_path(body.project_name)
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    # Get current remote URL and embed token
    rc, remote_url_raw, _ = await _run_git(["remote", "get-url", body.remote], project_path)
    if rc != 0:
        raise HTTPException(status_code=400, detail="Remote 'origin' not configured")

    auth_url = _inject_token_into_url(remote_url_raw.strip(), user.github_access_token)

    # Temporarily update remote URL (restore after push)
    await _run_git(["remote", "set-url", body.remote, auth_url], project_path)

    try:
        branch_args = [body.branch] if body.branch else []
        rc, stdout, stderr = await _run_git(["push", body.remote] + branch_args, project_path)
    finally:
        # Restore clean URL (no token)
        clean_url = re.sub(r"://[^@]+@", "://", remote_url_raw.strip())
        await _run_git(["remote", "set-url", body.remote, clean_url], project_path)

    if rc != 0:
        raise HTTPException(status_code=400, detail=f"git push failed: {stderr[:400]}")

    logger.info("git_pushed", project=body.project_name, user=user.email)
    return {"ok": True, "output": stdout.strip() or stderr.strip()}


# ── Init (new project) ────────────────────────────────────────────────────────

class InitRequest(BaseModel):
    project_name: str
    remote_url: str = ""   # https GitHub URL to add as origin
    default_branch: str = "main"


@router.post("/init")
async def git_init(body: InitRequest, user=Depends(require_roles("engineer", "admin"))):
    """Initialise a git repo in an existing or new project directory."""
    project_path = _safe_project_path(body.project_name)
    project_path.mkdir(parents=True, exist_ok=True)

    # Check if already a git repo
    git_dir = project_path / ".git"
    if git_dir.exists():
        raise HTTPException(status_code=409, detail="Already a git repository")

    rc, _, err = await _run_git(["init", "-b", body.default_branch], project_path)
    if rc != 0:
        raise HTTPException(status_code=400, detail=f"git init failed: {err[:200]}")

    if body.remote_url:
        rc2, _, err2 = await _run_git(["remote", "add", "origin", body.remote_url], project_path)
        if rc2 != 0:
            raise HTTPException(status_code=400, detail=f"Failed to add remote: {err2[:200]}")

    return {"ok": True, "project_name": body.project_name, "project_path": f"projects/{body.project_name}"}


# ── Create GitHub repo ────────────────────────────────────────────────────────

class CreateRepoRequest(BaseModel):
    name: str
    description: str = ""
    private: bool = True
    auto_init: bool = False


@router.post("/create-repo")
async def create_github_repo(body: CreateRepoRequest, user=Depends(require_roles("engineer", "admin"))):
    """Create a new GitHub repository via the GitHub API."""
    import httpx

    if not user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub not connected")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.github.com/user/repos",
                json={
                    "name": body.name,
                    "description": body.description,
                    "private": body.private,
                    "auto_init": body.auto_init,
                },
                headers={
                    "Authorization": f"token {user.github_access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            if resp.status_code == 422:
                raise HTTPException(status_code=409, detail="Repository already exists or name is invalid")
            resp.raise_for_status()
            repo = resp.json()

        return {
            "ok": True,
            "name": repo["name"],
            "full_name": repo["full_name"],
            "clone_url": repo["clone_url"],
            "html_url": repo["html_url"],
            "private": repo["private"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"GitHub API error: {exc}")


# ── Log ───────────────────────────────────────────────────────────────────────

@router.get("/log")
async def git_log(project_name: str, limit: int = 20, user=Depends(get_current_user)):
    """Return recent commits for a project."""
    project_path = _safe_project_path(project_name)
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    fmt = "%H%x1f%an%x1f%ae%x1f%ai%x1f%s"
    rc, stdout, stderr = await _run_git(
        ["log", f"--max-count={limit}", f"--format={fmt}"],
        project_path,
    )
    if rc != 0:
        raise HTTPException(status_code=400, detail=stderr[:200])

    commits = []
    for line in stdout.strip().splitlines():
        parts = line.split("\x1f")
        if len(parts) == 5:
            commits.append({
                "sha": parts[0],
                "author": parts[1],
                "author_email": parts[2],
                "date": parts[3],
                "message": parts[4],
            })

    return {"commits": commits}


# ── List projects ─────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects(user=Depends(get_current_user)):
    """List cloned/initialised git projects in the workspace."""
    root = _workspace_root()
    projects = []
    for item in sorted(root.iterdir()):
        if not item.is_dir():
            continue
        is_git = (item / ".git").exists()
        projects.append({
            "name": item.name,
            "path": f"projects/{item.name}",
            "is_git": is_git,
        })
    return {"projects": projects}
