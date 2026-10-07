export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly details: unknown = {}, readonly retryable = false) { super(message); this.name = 'ApiError' }
}
