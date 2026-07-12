export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code = "API_ERROR", details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
