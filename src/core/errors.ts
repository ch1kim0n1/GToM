/**
 * Custom error classes for GToM
 */

export class GToMError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GToMError';
  }
}

export class DatabaseError extends GToMError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends GToMError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class VulnerabilityError extends GToMError {
  constructor(message: string) {
    super(message, 'VULNERABILITY_ERROR');
    this.name = 'VulnerabilityError';
  }
}

export class AuthenticityError extends GToMError {
  constructor(message: string) {
    super(message, 'AUTHENTICITY_ERROR');
    this.name = 'AuthenticityError';
  }
}

export class TheoryOfMindError extends GToMError {
  constructor(message: string) {
    super(message, 'TOM_ERROR');
    this.name = 'TheoryOfMindError';
  }
}

export class BudgetExceededError extends GToMError {
  constructor(message: string) {
    super(message, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
  }
}
