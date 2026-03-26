import client from './client'
import type {
  GitHubRepo,
  GitHubReposResponse,
  CloneResult,
  GitStatus,
  GitCommit,
  GitProject,
} from '@/types/git'

export const gitApi = {
  // ── GitHub ────────────────────────────────────────────────────────────────

  /** Get OAuth URL to connect GitHub with repo scope */
  async getGitHubConnectUrl(redirectUri: string): Promise<{ url: string; state: string }> {
    const res = await client.get('/auth/oauth/github/url', { params: { redirect_uri: redirectUri } })
    return res.data
  },

  /** Exchange OAuth code for GitHub connection (existing account) */
  async connectGitHub(code: string, redirectUri: string): Promise<{ ok: boolean; github_connected: boolean }> {
    const res = await client.post('/auth/github/connect', { code, redirect_uri: redirectUri })
    return res.data
  },

  /** Disconnect GitHub from current account */
  async disconnectGitHub(): Promise<{ ok: boolean }> {
    const res = await client.delete('/auth/github/disconnect')
    return res.data
  },

  /** List user's GitHub repos with ML detection */
  async listRepos(page = 1, perPage = 30): Promise<GitHubReposResponse> {
    const res = await client.get('/auth/github/repos', { params: { page, per_page: perPage } })
    return res.data
  },

  // ── Workspace projects ─────────────────────────────────────────────────────

  async listProjects(): Promise<{ projects: GitProject[] }> {
    const res = await client.get('/git/projects')
    return res.data
  },

  // ── Clone ─────────────────────────────────────────────────────────────────

  async clone(cloneUrl: string, projectName?: string, branch?: string): Promise<CloneResult> {
    const res = await client.post('/git/clone', {
      clone_url: cloneUrl,
      project_name: projectName || '',
      branch: branch || '',
    })
    return res.data
  },

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(projectName: string, remoteUrl?: string, defaultBranch = 'main') {
    const res = await client.post('/git/init', {
      project_name: projectName,
      remote_url: remoteUrl || '',
      default_branch: defaultBranch,
    })
    return res.data
  },

  // ── Create repo ───────────────────────────────────────────────────────────

  async createRepo(
    name: string,
    description: string,
    isPrivate: boolean,
  ): Promise<{ ok: boolean; name: string; full_name: string; clone_url: string; html_url: string; private: boolean }> {
    const res = await client.post('/git/create-repo', {
      name,
      description,
      private: isPrivate,
    })
    return res.data
  },

  // ── Status ────────────────────────────────────────────────────────────────

  async status(projectName: string): Promise<GitStatus> {
    const res = await client.get('/git/status', { params: { project_name: projectName } })
    return res.data
  },

  // ── Commit ────────────────────────────────────────────────────────────────

  async commit(
    projectName: string,
    message: string,
    authorName?: string,
    authorEmail?: string,
  ): Promise<{ ok: boolean; sha: string | null; message: string }> {
    const res = await client.post('/git/commit', {
      project_name: projectName,
      message,
      author_name: authorName || '',
      author_email: authorEmail || '',
    })
    return res.data
  },

  // ── Push ──────────────────────────────────────────────────────────────────

  async push(
    projectName: string,
    remote = 'origin',
    branch = '',
  ): Promise<{ ok: boolean; output: string }> {
    const res = await client.post('/git/push', { project_name: projectName, remote, branch })
    return res.data
  },

  // ── Log ───────────────────────────────────────────────────────────────────

  async log(projectName: string, limit = 20): Promise<{ commits: GitCommit[] }> {
    const res = await client.get('/git/log', { params: { project_name: projectName, limit } })
    return res.data
  },
}
