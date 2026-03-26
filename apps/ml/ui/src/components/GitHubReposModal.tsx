import { useState, useEffect, useCallback } from 'react'
import {
  X, Github, Star, Lock, Globe, Cpu, BookOpen,
  Search, RefreshCw, GitBranch, Download, ChevronRight,
  AlertCircle, CheckCircle2, Loader2, ExternalLink,
} from 'lucide-react'
import { gitApi } from '@/api/git'
import type { GitHubRepo } from '@/types/git'

interface Props {
  onClose: () => void
  onCloned: (projectName: string, projectPath: string, isMl: boolean) => void
}

export default function GitHubReposModal({ onClose, onCloned }: Props) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [mlOnly, setMlOnly] = useState(false)
  const [cloning, setCloning] = useState<number | null>(null)
  const [cloneResult, setCloneResult] = useState<{ repoId: number; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await gitApi.listRepos(1, 50)
      setRepos(data.repos)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'Failed to load repositories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = repos.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase())
    const matchMl = !mlOnly || r.is_ml_project
    return matchSearch && matchMl
  })

  const handleClone = async (repo: GitHubRepo) => {
    setCloning(repo.id)
    setCloneResult(null)
    try {
      const result = await gitApi.clone(repo.clone_url, repo.name, repo.default_branch)
      setCloneResult({ repoId: repo.id, name: result.project_name })
      onCloned(result.project_name, result.project_path, result.is_ml_project)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'Clone failed')
    } finally {
      setCloning(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <Github size={18} className="text-white" />
            <span className="text-sm font-semibold text-white">Import from GitHub</span>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search repositories..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mlOnly}
              onChange={e => setMlOnly(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-brand-500 focus:ring-0 focus:ring-offset-0"
            />
            ML projects only
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 bg-red-950/50 border border-red-800/50 rounded-lg text-xs text-red-300">
            <AlertCircle size={13} className="flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Repo list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-gray-500" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-12 text-sm text-gray-500">
              {mlOnly ? 'No ML projects detected in your repositories.' : 'No repositories found.'}
            </p>
          ) : (
            filtered.map(repo => {
              const isCloned = cloneResult?.repoId === repo.id
              const isCloning = cloning === repo.id
              return (
                <div
                  key={repo.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-gray-800 hover:border-gray-700 bg-gray-900/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{repo.name}</span>
                      {repo.private
                        ? <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400"><Lock size={9} />Private</span>
                        : <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400"><Globe size={9} />Public</span>
                      }
                      {repo.is_ml_project && (
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-brand-950/80 border border-brand-700/40 text-brand-300">
                          <Cpu size={9} />ML
                        </span>
                      )}
                      {repo.language === 'Jupyter Notebook' && (
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-950/60 border border-orange-700/40 text-orange-300">
                          <BookOpen size={9} />Notebook
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{repo.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-600">
                      {repo.language && <span>{repo.language}</span>}
                      {repo.stargazers_count > 0 && (
                        <span className="flex items-center gap-1"><Star size={10} />{repo.stargazers_count}</span>
                      )}
                      <span className="flex items-center gap-1"><GitBranch size={10} />{repo.default_branch}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors"
                      title="Open on GitHub"
                    >
                      <ExternalLink size={13} />
                    </a>
                    {isCloned ? (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <CheckCircle2 size={13} />Cloned
                      </span>
                    ) : (
                      <button
                        onClick={() => handleClone(repo)}
                        disabled={isCloning || cloning !== null}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isCloning ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                        {isCloning ? 'Cloning…' : 'Clone'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
          <span>{filtered.length} of {repos.length} repositories</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
