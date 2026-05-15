export type LogContext = Record<string, unknown>;

export class StructuredLogger {
  constructor(private readonly name: string) {}

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.write('error', message, {
      ...context,
      error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined,
    });
  }

  private write(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message,
      context,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export function createLogger(name: string): StructuredLogger {
  return new StructuredLogger(name);
}
