/**
 * Logging utility for GToM
 */

import { LocalLogger } from './observability.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export class Logger {
  private level: LogLevel;
  private entries: LogEntry[] = [];
  private structuredLogger: LocalLogger;

  constructor(level: LogLevel = LogLevel.INFO, name = 'gtom') {
    this.level = level;
    this.structuredLogger = new LocalLogger(name);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (level < this.level) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context,
    };

    this.entries.push(entry);

    const levelName = LogLevel[level];
    const normalizedLevel = levelName.toLowerCase() as 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    if (normalizedLevel === 'error' || normalizedLevel === 'fatal') {
      this.structuredLogger[normalizedLevel](message, undefined, context);
    } else {
      this.structuredLogger[normalizedLevel](message, context);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.FATAL, message, context);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clearEntries(): void {
    this.entries = [];
  }
}

export const logger = new Logger(LogLevel.INFO);
