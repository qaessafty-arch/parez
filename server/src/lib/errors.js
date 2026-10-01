/**
 * Errors — consistent API error responses.
 * Codes are stable so the client can translate them (i18n).
 */
export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Not authenticated') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not permitted') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const validationError = (message, details) => new AppError(422, 'VALIDATION_FAILED', message, details);
export const serverError = (message = 'Internal server error') => new AppError(500, 'SERVER_ERROR', message);
export const dbUnavailable = () =>
  new AppError(503, 'DB_UNAVAILABLE', 'Unable to connect to the database. Your information has not been saved.');
