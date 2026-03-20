import { useState, useRef } from 'react'
import { collectApi } from '@/api/datasets'
import type { DatasetEntry } from '@/types/dataset'

const CHUNK_SIZE = 10 * 1024 * 1024 // 10 MB

export interface MultipartUploadOptions {
  onProgress?: (pct: number) => void
}

export function useMultipartUpload(opts: MultipartUploadOptions = {}) {
  const [progress, setProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const abortRef = useRef(false)

  const upload = async (
    token: string,
    fieldId: string,
    file: File,
    extra: {
      description?: string
      lat?: number
      lng?: number
      accuracy?: number
      consent_record_id?: string
    } = {}
  ): Promise<DatasetEntry> => {
    setIsUploading(true)
    setProgress(0)
    abortRef.current = false

    // Compute SHA-256 before upload so backend can reject duplicates
    const hashBuf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const file_hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

    const { upload_id, key } = await collectApi.initiateMultipart(
      token, fieldId, file.name, file.type || 'application/octet-stream'
    )

    const totalParts = Math.ceil(file.size / CHUNK_SIZE)
    const parts: { part_number: number; etag: string }[] = []

    try {
      for (let i = 0; i < totalParts; i++) {
        if (abortRef.current) throw new Error('Upload cancelled')

        const start = i * CHUNK_SIZE
        const chunk = file.slice(start, start + CHUNK_SIZE)
        const partNumber = i + 1

        const { url } = await collectApi.getPartUrl(token, key, upload_id, partNumber)

        // Do NOT set Content-Type — boto3 presigns upload_part without it,
        // so including it causes a signature mismatch (403).
        const resp = await fetch(url, {
          method: 'PUT',
          body: chunk,
        })

        if (!resp.ok) throw new Error(`Part ${partNumber} failed (${resp.status})`)

        // ETag may be quoted — keep as-is, S3 expects the quoted form
        const etag = resp.headers.get('ETag') || resp.headers.get('etag') || ''
        parts.push({ part_number: partNumber, etag })

        const pct = Math.round(((i + 1) / totalParts) * 100)
        setProgress(pct)
        opts.onProgress?.(pct)
      }

      const entry = await collectApi.completeMultipart(token, {
        field_id: fieldId,
        key,
        upload_id,
        parts,
        file_mime: file.type || 'application/octet-stream',
        file_hash,
        ...extra,
      })

      setIsUploading(false)
      return entry
    } catch (err) {
      setIsUploading(false)
      setProgress(0)
      throw err
    }
  }

  const cancel = () => { abortRef.current = true }

  return { upload, progress, isUploading, cancel }
}
