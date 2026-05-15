declare module 'proper-lockfile' {
  export interface LockOptions {
    retries?: number | {
      retries?: number;
      factor?: number;
      minTimeout?: number;
      maxTimeout?: number;
      randomize?: boolean;
    };
  }

  export function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
}
