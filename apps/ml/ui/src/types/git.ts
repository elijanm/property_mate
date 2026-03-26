export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  description: string
  html_url: string
  clone_url: string
  ssh_url: string
  default_branch: string
  language: string
  topics: string[]
  private: boolean
  updated_at: string
  stargazers_count: number
  is_ml_project: boolean
}

export interface GitHubReposResponse {
  repos: GitHubRepo[]
  page: number
  per_page: number
  total: number
}

export interface CloneResult {
  ok: boolean
  project_name: string
  project_path: string
  ml_files: string[]
  has_base_trainer: boolean
  has_notebooks: boolean
  has_requirements: boolean
  is_ml_project: boolean
}

export interface GitStatusFile {
  status: string
  path: string
}

export interface GitStatus {
  branch: string
  changed: GitStatusFile[]
  clean: boolean
  remote_url: string
}

export interface GitCommit {
  sha: string
  author: string
  author_email: string
  date: string
  message: string
}

export interface GitProject {
  name: string
  path: string
  is_git: boolean
}
