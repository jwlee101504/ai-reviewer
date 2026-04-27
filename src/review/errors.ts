export class ReviewSkipError extends Error {
  readonly skip = true as const;

  constructor(message: string) {
    super(message);
    this.name = "ReviewSkipError";
  }
}

export function isReviewSkipError(value: unknown): value is ReviewSkipError {
  return value instanceof ReviewSkipError;
}
