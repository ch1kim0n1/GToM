/**
 * Authenticity Analyzer for GToM
 * Analyzes authenticity of content
 */

import { logger } from './logger.js';
import { LLMClient } from './llm-client.js';

export interface AuthenticityFactors {
  source: number;
  consistency: number;
  timestamp: number;
  crossReference: number;
}

export interface AuthenticityResult {
  id: string;
  target: string;
  score: number;
  confidence: number;
  factors: AuthenticityFactors;
  timestamp: Date;
}

export class AuthenticityAnalyzer {
  private llmClient: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient ?? new LLMClient();
  }

  async analyze(target: string): Promise<AuthenticityResult> {
    logger.info('Analyzing authenticity', { target });

    let factors: AuthenticityFactors = { source: 0.5, consistency: 0.5, timestamp: 0.5, crossReference: 0.5 };
    let confidence = 0.5;

    try {
      const response = await this.llmClient.call(
        `Analyze the authenticity of the following content or entity: ${JSON.stringify(target)}
Evaluate source credibility, internal consistency, temporal plausibility, and cross-reference potential.
Respond with JSON only: { "source": number (0-1), "consistency": number (0-1), "timestamp": number (0-1), "crossReference": number (0-1), "confidence": number (0-1) }`,
        { model: 'claude-haiku-4-5-20251001' },
      );
      const parsed = JSON.parse(response.content);
      factors = {
        source: parsed.source ?? factors.source,
        consistency: parsed.consistency ?? factors.consistency,
        timestamp: parsed.timestamp ?? factors.timestamp,
        crossReference: parsed.crossReference ?? factors.crossReference,
      };
      confidence = typeof parsed.confidence === 'number' ? parsed.confidence : confidence;
    } catch {
      logger.warn('Authenticity LLM analysis failed, using defaults', { target });
    }

    const score = (factors.source + factors.consistency + factors.timestamp + factors.crossReference) / 4;

    return {
      id: `auth-${Date.now()}`,
      target,
      score,
      confidence,
      factors,
      timestamp: new Date(),
    };
  }

  async analyzeBatch(targets: string[]): Promise<AuthenticityResult[]> {
    logger.info('Analyzing authenticity batch', { count: targets.length });
    
    const results: AuthenticityResult[] = [];
    for (const target of targets) {
      const result = await this.analyze(target);
      results.push(result);
    }
    
    return results;
  }
}
