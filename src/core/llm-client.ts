/**
 * LLM Client for G-Stack Tools
 *
 * Provides:
 * - Model pricing tables (Anthropic, OpenAI)
 * - Token counting and cost tracking
 * - Standardized LLM call interface
 * - Multi-tier model selection
 * - Real API integration with retry logic
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** Average latency in ms. */
  avg_latency_ms: number;
}

export interface LLMCallResult {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model_id: string;
  cost_usd: number;
  latency_ms: number;
}

export interface LLMClientConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  defaultModel?: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

/** Anthropic model pricing (as of 2026-05-01) */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { input: 5.00, output: 25.00, avg_latency_ms: 5000 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, avg_latency_ms: 2000 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, avg_latency_ms: 500 },
  'claude-opus-4-6': { input: 5.00, output: 25.00, avg_latency_ms: 5000 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, avg_latency_ms: 2000 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00, avg_latency_ms: 500 },
};

/** OpenAI model pricing (as of 2026-05-01) */
export const OPENAI_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.50, output: 10.00, avg_latency_ms: 1500 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, avg_latency_ms: 300 },
  'gpt-4-turbo': { input: 10.00, output: 30.00, avg_latency_ms: 3000 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50, avg_latency_ms: 800 },
};

/** Combined pricing map */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  ...ANTHROPIC_PRICING,
  ...OPENAI_PRICING,
};

/** Model tier configurations */
export const MODEL_TIERS = {
  tier1: 'claude-haiku-4-5-20251001',
  tier2: 'claude-sonnet-4-6',
  tier3: 'claude-opus-4-7',
};

/**
 * Estimate cost for a model call
 */
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) {
    console.warn(`[LLMClient] No pricing for model: ${modelId}`);
    return 0;
  }
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Get pricing for a model
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  return MODEL_PRICING[modelId] || null;
}

/**
 * Simple token counter (approximate)
 * In production, use provider-specific tokenizers
 */
export function estimateTokens(text: string): number {
  // Rough approximation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * LLM Client class
 */
export class LLMClient {
  private config: Required<LLMClientConfig>;
  private anthropicClient: Anthropic | null = null;
  private openaiClient: OpenAI | null = null;
  private totalCostUsd: number = 0;
  private totalTokens: number = 0;
  private callCount: number = 0;

  constructor(config: LLMClientConfig = {}) {
    this.config = {
      defaultModel: 'claude-sonnet-4-6',
      maxTokens: 4096,
      timeoutMs: 30000,
      maxRetries: 3,
      retryBaseDelayMs: 1000,
      anthropicApiKey: config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
      openaiApiKey: config.openaiApiKey || process.env.OPENAI_API_KEY || '',
    };

    if (this.config.anthropicApiKey) {
      this.anthropicClient = new Anthropic({
        apiKey: this.config.anthropicApiKey,
        timeout: this.config.timeoutMs,
      });
    }

    if (this.config.openaiApiKey) {
      this.openaiClient = new OpenAI({
        apiKey: this.config.openaiApiKey,
        timeout: this.config.timeoutMs,
      });
    }
  }

  /**
   * Call an LLM with the given prompt
   */
  async call(
    prompt: string,
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<LLMCallResult> {
    const model = options.model || this.config.defaultModel || 'claude-sonnet-4-6';
    const maxTokens = options.maxTokens || this.config.maxTokens || 4096;
    const temperature = options.temperature ?? 0.7;
    const startTime = Date.now();

    const inputTokens = estimateTokens(prompt);
    let content: string;

    if (this.anthropicClient && this.isAnthropicModel(model)) {
      content = await this.callAnthropic(prompt, model, maxTokens, temperature);
    } else if (this.openaiClient && this.isOpenAIModel(model)) {
      content = await this.callOpenAI(prompt, model, maxTokens, temperature);
    } else {
      // Fallback to simulation if no client available
      content = await this.simulateLLMCall(prompt, model, temperature);
    }

    const outputTokens = estimateTokens(content);
    const latency = Date.now() - startTime;
    const cost = estimateCostUsd(model, inputTokens, outputTokens);

    this.totalCostUsd += cost;
    this.totalTokens += inputTokens + outputTokens;
    this.callCount++;

    return {
      content,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model_id: model,
      cost_usd: cost,
      latency_ms: latency,
    };
  }

  /**
   * Call an LLM with tier-based invocation and escalation
   * Starts at the specified tier and escalates to higher tiers on failure
   */
  async callWithTier(
    prompt: string,
    options: {
      tier?: 'tier1' | 'tier2' | 'tier3';
      maxTokens?: number;
      temperature?: number;
      allowEscalation?: boolean;
    } = {}
  ): Promise<LLMCallResult> {
    const startTier = options.tier || 'tier1';
    const maxTokens = options.maxTokens || this.config.maxTokens || 4096;
    const temperature = options.temperature ?? 0.7;
    const allowEscalation = options.allowEscalation !== false;

    const tierOrder: Array<'tier1' | 'tier2' | 'tier3'> = ['tier1', 'tier2', 'tier3'];
    const startIndex = tierOrder.indexOf(startTier);
    const tiersToTry = allowEscalation
      ? tierOrder.slice(startIndex)
      : [startTier];

    let lastError: any = null;

    for (const tier of tiersToTry) {
      try {
        const model = this.getModelByTier(tier);
        console.log(`[GToM LLMClient] Using ${tier}: ${model}`);

        const result = await this.call(prompt, {
          model,
          maxTokens,
          temperature,
        });

        return result;
      } catch (error) {
        console.warn(`[GToM LLMClient] ${tier} failed:`, error);
        lastError = error;
        continue;
      }
    }

    throw new Error(
      `All tiers failed. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Simulate an LLM call (fallback when SDK clients are not available)
   */
  private async simulateLLMCall(
    prompt: string,
    model: string,
    temperature?: number
  ): Promise<string> {
    const pricing = MODEL_PRICING[model];
    const latency = pricing?.avg_latency_ms || 1000;
    await new Promise(resolve => setTimeout(resolve, latency / 10));

    if (prompt.toLowerCase().includes('influence') || prompt.toLowerCase().includes('manipulation')) {
      return JSON.stringify({
        patterns: [
          { pattern: 'authority_bias', severity: 'medium', confidence: 0.7 },
          { pattern: 'social_proof', severity: 'low', confidence: 0.5 },
        ],
        reasoning: 'Detected potential influence tactics in content'
      });
    }

    if (prompt.toLowerCase().includes('vulnerability') || prompt.toLowerCase().includes('cognitive')) {
      return JSON.stringify({
        vulnerability_delta: 0.1,
        reasoning: 'Content increases susceptibility to manipulation'
      });
    }

    return JSON.stringify({
      response: 'Analyzed',
      confidence: 0.7
    });
  }

  /**
   * Check if a model is an Anthropic model
   */
  private isAnthropicModel(model: string): boolean {
    return model.startsWith('claude-');
  }

  /**
   * Check if a model is an OpenAI model
   */
  private isOpenAIModel(model: string): boolean {
    return model.startsWith('gpt-') || model.startsWith('o1-');
  }

  /**
   * Retry a function with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const maxRetries = this.config.maxRetries || 3;
    const baseDelay = this.config.retryBaseDelayMs || 1000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain errors (e.g., authentication errors)
        if (error instanceof Error && this.isNonRetryableError(error)) {
          throw error;
        }

        // Don't retry after the last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Check if this is a rate limit error
        let delay: number;
        const rateLimitDelay = this.getRateLimitRetryDelay(error as Error);

        if (rateLimitDelay !== null) {
          delay = rateLimitDelay;
          console.warn(
            `[LLMClient] ${operationName} attempt ${attempt + 1}/${maxRetries + 1} hit rate limit, ` +
            `retrying in ${delay}ms (Retry-After respected):`,
            error
          );
        } else {
          // Calculate exponential backoff delay
          delay = baseDelay * Math.pow(2, attempt);
          console.warn(
            `[LLMClient] ${operationName} attempt ${attempt + 1}/${maxRetries + 1} failed, ` +
            `retrying in ${delay}ms:`,
            error
          );
        }

        await this.sleep(delay);
      }
    }

    throw new Error(
      `${operationName} failed after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`
    );
  }

  /**
   * Check if an error is non-retryable (e.g., authentication errors)
   */
  private isNonRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();

    // Authentication errors
    if (errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
      return true;
    }

    // Invalid request errors (but not rate limit errors)
    if (errorMessage.includes('invalid') && errorMessage.includes('request') && !errorMessage.includes('429')) {
      return true;
    }

    return false;
  }

  /**
   * Check if an error is a rate limit error and extract retry delay
   */
  private getRateLimitRetryDelay(error: Error): number | null {
    const errorMessage = error.message.toLowerCase();

    // Check for 429 status code
    if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
      // Try to extract Retry-After header from error message
      const retryAfterMatch = errorMessage.match(/retry-after[:\s]+(\d+)/i);
      if (retryAfterMatch) {
        const retryAfterSeconds = parseInt(retryAfterMatch[1], 10);
        if (!isNaN(retryAfterSeconds)) {
          return retryAfterSeconds * 1000; // Convert to milliseconds
        }
      }

      // Default to a reasonable delay if no Retry-After header
      return 5000; // 5 seconds default
    }

    return null;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(
    prompt: string,
    model: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    return this.retryWithBackoff(async () => {
      const message = await this.anthropicClient!.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text content from response
      const textContent = message.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      return textContent;
    }, `Anthropic API call (model: ${model})`);
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(
    prompt: string,
    model: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    return this.retryWithBackoff(async () => {
      const completion = await this.openaiClient!.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: maxTokens,
        temperature,
      });

      return completion.choices[0]?.message?.content || '';
    }, `OpenAI API call (model: ${model})`);
  }

  /**
   * Get total cost incurred
   */
  getTotalCostUsd(): number {
    return this.totalCostUsd;
  }

  /**
   * Get total tokens used
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }

  /**
   * Get call count
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.totalCostUsd = 0;
    this.totalTokens = 0;
    this.callCount = 0;
  }

  /**
   * Get model by tier
   */
  getModelByTier(tier: 'tier1' | 'tier2' | 'tier3'): string {
    return MODEL_TIERS[tier];
  }
}
