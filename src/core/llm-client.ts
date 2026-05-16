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
import { encoding_for_model, get_encoding } from 'tiktoken';
import { createLogger } from './structured-logger.js';
import { BudgetLedger } from './budget-ledger.js';
import { BudgetExceededError } from './errors.js';
import { globalObservability } from './observability.js';
import { defaultSecretManager } from './secret-manager.js';
import {
  MODEL_RESOLUTION_CHAIN_8,
  resolveModelFromChain,
  type ModelResolutionTier,
} from './performance.js';

const logger = createLogger('gtom-llm-client');

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
  budgetLedger?: BudgetLedger;
  maxBudgetUsd?: number;
  reservationTtlMs?: number;
  resolver?: string;
  scope?: string;
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
  tier2: 'gpt-4o-mini',
  tier3: 'claude-sonnet-4-6',
  tier4: 'gpt-4o',
  tier5: 'claude-opus-4-7',
  tier6: 'gpt-4-turbo',
  tier7: 'claude-3-5-sonnet-20241022',
  tier8: 'claude-opus-4-6',
};

export const MODEL_RESOLUTION_CHAIN = MODEL_RESOLUTION_CHAIN_8;

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
    globalObservability.logger.warn('No pricing for model', { model_id: modelId });
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
 * Token counter using tiktoken for accurate token counting
 * Falls back to general-purpose tokenizer if model-specific one fails
 */
export function estimateTokens(text: string, model: string = 'gpt-4o'): number {
  try {
    const encoding = encoding_for_model(model as any);
    const tokens = encoding.encode(text);
    encoding.free();
    return tokens.length;
  } catch (error) {
    // Fallback to a general-purpose tokenizer rather than a length heuristic
    globalObservability.logger.warn('tiktoken failed, falling back to cl100k_base', { error, model });
    try {
      const fallback = get_encoding('cl100k_base');
      const tokens = fallback.encode(text);
      fallback.free();
      return tokens.length;
    } catch (e) {
      // Last resort: rough approximation
      return Math.ceil(text.length / 4);
    }
  }
}

/**
 * LLM Client class
 */
export class LLMClient {
  private config: Required<Pick<
    LLMClientConfig,
    'anthropicApiKey' | 'openaiApiKey' | 'defaultModel' | 'maxTokens' | 'timeoutMs' | 'maxRetries' | 'retryBaseDelayMs'
  >>;
  private anthropicClient: Anthropic | null = null;
  private openaiClient: OpenAI | null = null;
  private totalCostUsd: number = 0;
  private totalTokens: number = 0;
  private callCount: number = 0;
  private logger = createLogger('gtom');
  private budgetLedger: BudgetLedger;
  private resolver: string;
  private scope: string;

  constructor(config: LLMClientConfig = {}) {
    this.config = {
      defaultModel: 'claude-sonnet-4-6',
      maxTokens: 4096,
      timeoutMs: 30000,
      maxRetries: 3,
      retryBaseDelayMs: 1000,
      anthropicApiKey: config.anthropicApiKey || defaultSecretManager.getSecret('ANTHROPIC_API_KEY') || '',
      openaiApiKey: config.openaiApiKey || defaultSecretManager.getSecret('OPENAI_API_KEY') || '',
    };
    this.budgetLedger = config.budgetLedger ?? new BudgetLedger({
      maxBudgetUsd: config.maxBudgetUsd ?? Number(process.env.GTOM_MAX_BUDGET_USD ?? 20),
      defaultTtlMs: config.reservationTtlMs,
      resolverCapsUsd: this.parseCaps(process.env.GTOM_RESOLVER_CAPS_USD),
      scopeCapsUsd: this.parseCaps(process.env.GTOM_SCOPE_CAPS_USD),
    }, 'gtom');
    this.totalCostUsd = this.budgetLedger.getTotalSpendUsd();
    this.resolver = config.resolver ?? 'llm';
    this.scope = config.scope ?? 'default';

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
    const selected = this.selectModel(prompt, options.model);
    const model = selected.model_id;
    const maxTokens = options.maxTokens || this.config.maxTokens || 4096;
    const temperature = options.temperature ?? 0.7;
    const startTime = Date.now();
    const estimatedInputTokens = estimateTokens(prompt, model);
    const estimatedCost = estimateCostUsd(model, estimatedInputTokens, maxTokens);
    
    // Budget hard gate: check if budget is exceeded before reserving
    const budgetStatus = this.budgetLedger.getStatus();
    if (budgetStatus.remaining_budget_usd <= 0) {
      throw new BudgetExceededError(
        `Budget of $${budgetStatus.max_budget_usd.toFixed(4)} exceeded; aborting task. Spent: $${budgetStatus.total_committed_usd.toFixed(4)}`
      );
    }
    
    const reservation = this.budgetLedger.reserve('llm.call', estimatedCost, {
      ttlMs: this.config.timeoutMs + 60_000,
      resolver: this.resolver,
      scope: this.scope,
      metadata: { model, maxTokens, temperature },
    });

    let content: string;
    let inputTokens: number;
    let outputTokens: number;

    try {
      if (this.anthropicClient && this.isAnthropicModel(model)) {
        const result = await this.callAnthropic(prompt, model, maxTokens, temperature);
        content = result.content;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      } else if (this.openaiClient && this.isOpenAIModel(model)) {
        const result = await this.callOpenAI(prompt, model, maxTokens, temperature);
        content = result.content;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      } else {
        throw new Error(`No API client available for model: ${model}`);
      }
    } catch (error) {
      this.budgetLedger.release(reservation.id);
      throw error;
    }

    if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
      inputTokens = estimatedInputTokens;
      outputTokens = estimateTokens(content, model);
    }
    const latency = Date.now() - startTime;
    const cost = estimateCostUsd(model, inputTokens, outputTokens);

    this.budgetLedger.commit(reservation.id, cost, {
      model_id: model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      operation: 'llm.call',
      resolver: this.resolver,
      scope: this.scope,
    });
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
        logger.info(`Using ${tier}: ${model}`);

        const result = await this.call(prompt, {
          model,
          maxTokens,
          temperature,
        });

        return result;
      } catch (error) {
        logger.warn(`${tier} failed`, { error });
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
  private async callAnthropic(
    prompt: string,
    model: string,
    maxTokens: number,
    temperature: number
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
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

      return {
        content: message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
        inputTokens: message.usage?.input_tokens ?? Number.NaN,
        outputTokens: message.usage?.output_tokens ?? Number.NaN,
      };
    }, `Anthropic API call (model: ${model})`);
  }

  private async callOpenAI(
    prompt: string,
    model: string,
    maxTokens: number,
    temperature: number
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
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

      return {
        content: completion.choices[0]?.message?.content || '',
        inputTokens: completion.usage?.prompt_tokens ?? Number.NaN,
        outputTokens: completion.usage?.completion_tokens ?? Number.NaN,
      };
    }, `OpenAI API call (model: ${model})`);
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
          globalObservability.logger.warn('LLM call hit rate limit; retrying after Retry-After delay', {
            operation: operationName,
            attempt: attempt + 1,
            max_attempts: maxRetries + 1,
            delay_ms: delay,
            error,
          });
        } else {
          // Calculate exponential backoff delay
          delay = baseDelay * Math.pow(2, attempt);
          globalObservability.logger.warn('LLM call failed; retrying with exponential backoff', {
            operation: operationName,
            attempt: attempt + 1,
            max_attempts: maxRetries + 1,
            delay_ms: delay,
            error,
          });
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
    this.totalCostUsd = this.budgetLedger.getTotalSpendUsd();
    this.totalTokens = 0;
    this.callCount = 0;
  }

  /**
   * Get model by tier
   */
  getModelByTier(tier: keyof typeof MODEL_TIERS): string {
    return MODEL_TIERS[tier];
  }

  private parseCaps(value: string | undefined): Record<string, number> {
    if (!value) return {};
    const caps: Record<string, number> = {};
    for (const segment of value.split(',')) {
      const [key, rawAmount] = segment.split(':');
      const amount = Number(rawAmount);
      if (key && Number.isFinite(amount) && amount >= 0) {
        caps[key.trim()] = amount;
      }
    }
    return caps;
  }

  private selectModel(prompt: string, preferredModel?: string): ModelResolutionTier {
    if (preferredModel) {
      return {
        tier: 0,
        name: 'explicit',
        model_id: preferredModel,
        provider: this.isOpenAIModel(preferredModel) ? 'openai' : 'anthropic',
        max_input_tokens: Number.MAX_SAFE_INTEGER,
        use_case: 'explicit caller override',
      };
    }
    const availableProviders: Array<'anthropic' | 'openai'> = [];
    if (this.anthropicClient) availableProviders.push('anthropic');
    if (this.openaiClient) availableProviders.push('openai');
    if (availableProviders.length === 0) {
      return {
        tier: 0,
        name: 'configured-default',
        model_id: this.config.defaultModel,
        provider: this.isOpenAIModel(this.config.defaultModel) ? 'openai' : 'anthropic',
        max_input_tokens: Number.MAX_SAFE_INTEGER,
        use_case: 'configured default with no active provider',
      };
    }
    return resolveModelFromChain({
      estimatedInputTokens: estimateTokens(prompt, this.config.defaultModel),
      preferredModel: this.config.defaultModel,
      availableProviders,
      allowExpensive: process.env.GTOM_ALLOW_EXPENSIVE_MODELS === 'true',
    });
  }
}
