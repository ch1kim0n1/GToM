#!/usr/bin/env node

/**
 * GToM Server Entry Point
 * 
 * Starts the HTTP server for GToM
 */

import { GToM } from './core/gtom';
import { GToMServer } from './server';
import { StructuredLogger } from './core/structured-logger.js';
import { HealthServer, type HealthCheckResult, type ReadinessCheckResult } from './core/health-server.js';

const port = parseInt(process.env.PORT || '3003', 10);
const healthPort = process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : 8080;
const gbrainEndpoint = process.env.GTOM_GBRAIN_ENDPOINT || process.env.GBRAIN_ENDPOINT || 'http://localhost:3000';
const logger = new StructuredLogger('gtom-serve');

async function main() {
  logger.info('Starting server');
  logger.info('GBrain endpoint', { gbrainEndpoint });
  logger.info('Port', { port });

  const gtom = new GToM({
    gbrainEndpoint,
    gbrainAuthToken: process.env.GTOM_GBRAIN_AUTH_TOKEN || process.env.GBRAIN_AUTH_TOKEN,
    gbrainMode: process.env.GTOM_GBRAIN_MODE === 'mcp' ? 'mcp' : 'http',
  });

  const server = new GToMServer(gtom, port);

  // Create health server
  const healthServer = new HealthServer(
    async (): Promise<HealthCheckResult> => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
    async (): Promise<ReadinessCheckResult> => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      dependencies: {},
    }),
    healthPort
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    await healthServer.shutdown();
    server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  healthServer.addShutdownHandler(async () => {
    logger.info('Cleanup complete');
  });

  try {
    await healthServer.start();
    await server.start();
    logger.info('Server started successfully');
  } catch (error) {
    logger.error('Failed to start server', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

main().catch((error) => logger.error('Main function error', error instanceof Error ? error : new Error(String(error))));
