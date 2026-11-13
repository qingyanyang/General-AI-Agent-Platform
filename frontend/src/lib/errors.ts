export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

function messageFromDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = detail.message
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }
  return null
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const fallback = `Request failed (${response.status})`
  const text = await response.text()
  if (!text) {
    return new ApiError(response.status, fallback)
  }
  try {
    const body = JSON.parse(text) as { detail?: unknown }
    return new ApiError(response.status, messageFromDetail(body.detail) ?? fallback)
  } catch {
    return new ApiError(response.status, fallback)
  }
}
