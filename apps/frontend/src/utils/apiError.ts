import type { AxiosError } from 'axios'
import type { ApiError, ApiErrorResponse } from '@/types/api'

const FALLBACK: ApiError = {
  code: 'UNKNOWN_ERROR',
  message: 'An unexpected error occurred. Please try again.',
}

export function extractApiError(error: unknown): ApiError {
  const axiosError = error as AxiosError<ApiErrorResponse>
  return axiosError.response?.data?.error ?? FALLBACK
}
