/**
 * Theory of Mind Model for GToM
 * Implements ToM reasoning capabilities
 */

import { logger } from './logger.js';
import { LLMClient } from './llm-client.js';

export interface ToMModelConfig {
  name: string;
  version: string;
  parameters: Record<string, unknown>;
}

export interface ToMInference {
  id: string;
  target: string;
  belief: string;
  intention: string;
  confidence: number;
  timestamp: Date;
}

export class ToMModel {
  private config: ToMModelConfig;
  private inferences: Map<string, ToMInference> = new Map();
  private llmClient: LLMClient;

  constructor(config: ToMModelConfig, llmClient?: LLMClient) {
    this.config = config;
    this.llmClient = llmClient ?? new LLMClient();
    logger.info('ToMModel initialized', { name: config.name, version: config.version });
  }

  async infer(target: string): Promise<ToMInference> {
    logger.info('Running ToM inference', { target });

    let belief = 'Unable to determine belief';
    let intention = 'Unable to determine intention';
    let confidence = 0.5;

    try {
      const response = await this.llmClient.call(
        `Perform Theory of Mind inference for the following target entity: ${JSON.stringify(target)}
Analyze their likely mental state, beliefs, and intentions based on available context.
Respond with JSON only: { "belief": string, "intention": string, "confidence": number (0-1) }`,
        { model: 'claude-haiku-4-5-20251001' },
      );
      const parsed = JSON.parse(response.content);
      belief = parsed.belief ?? belief;
      intention = parsed.intention ?? intention;
      confidence = typeof parsed.confidence === 'number' ? parsed.confidence : confidence;
    } catch {
      logger.warn('ToM LLM inference failed, using defaults', { target });
    }

    const inference: ToMInference = {
      id: `tom-${Date.now()}`,
      target,
      belief,
      intention,
      confidence,
      timestamp: new Date(),
    };

    this.inferences.set(inference.id, inference);
    return inference;
  }

  getInference(id: string): ToMInference | undefined {
    return this.inferences.get(id);
  }

  getInferencesByTarget(target: string): ToMInference[] {
    return Array.from(this.inferences.values()).filter(i => i.target === target);
  }

  updateConfig(config: Partial<ToMModelConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('ToMModel config updated');
  }

  clearInferences(): void {
    this.inferences.clear();
    logger.info('ToMModel inferences cleared');
  }
}
