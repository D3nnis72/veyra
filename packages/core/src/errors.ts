import type { z } from 'zod';

export class VeyraError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class NotFoundError extends VeyraError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(code, message, 404);
  }
}

export class ValidationError extends VeyraError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(code, message, 400);
  }
}

export class SystemProjectError extends VeyraError {
  constructor(message = 'System project "Other" cannot be deleted or archived') {
    super('SYSTEM_PROJECT_PROTECTED', message, 400);
  }
}

export class ConflictError extends VeyraError {
  constructor(message: string, code = 'CONFLICT') {
    super(code, message, 409);
  }
}

export function parseWithZod<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      })
      .join('; ');
    throw new ValidationError(details || 'Invalid input');
  }
  return result.data;
}
