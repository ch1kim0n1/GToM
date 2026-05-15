/**
 * Configuration management for GToM
 */

export interface GToMConfig {
  database: {
    type: 'sqlite' | 'postgres' | 'memory';
    dbPath?: string;
    connectionString?: string;
  };
  vulnerability: {
    enabled: boolean;
    threshold: number;
  };
  authenticity: {
    enabled: boolean;
    threshold: number;
  };
  server: {
    port: number;
    host: string;
  };
}

export const defaultConfig: GToMConfig = {
  database: {
    type: 'sqlite',
    dbPath: './gtom.db',
  },
  vulnerability: {
    enabled: true,
    threshold: 0.5,
  },
  authenticity: {
    enabled: true,
    threshold: 0.7,
  },
  server: {
    port: 8083,
    host: 'localhost',
  },
};

export function loadConfig(configPath?: string): GToMConfig {
  return defaultConfig;
}

export function mergeConfig(base: GToMConfig, override: Partial<GToMConfig>): GToMConfig {
  return {
    ...base,
    ...override,
    database: { ...base.database, ...override.database },
    vulnerability: { ...base.vulnerability, ...override.vulnerability },
    authenticity: { ...base.authenticity, ...override.authenticity },
    server: { ...base.server, ...override.server },
  };
}
