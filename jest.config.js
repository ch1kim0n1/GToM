const path = require('path');
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testEnvironmentOptions: {
    url: 'http://localhost',
  },
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/core/llm-client.ts',
    '!src/core/sqlite-engine.ts',
    '!src/core/migrate.ts',
    '!src/core/utils.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 60,
      functions: 80,
      lines: 80,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleDirectories: ['node_modules', path.resolve(__dirname, 'node_modules')],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^bun:test$': '<rootDir>/test/bun-test-shim.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
