import { GBrainClient } from '../src/core/gbrain-client.js';
import { GToM } from '../src/core/gtom.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GBrainClient', () => {
  it('uses typed HTTP calls with auth headers and Zod response validation', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      beliefs: [{ content: 'prefers reversible changes', confidence: 0.9, source: 'profile' }],
      desires: [],
      intentions: [],
      biases: [],
    }));
    const client = new GBrainClient({
      endpoint: 'http://gbrain.local/',
      authToken: 'test-token',
      fetchImpl,
      retryBaseDelayMs: 0,
    });

    const result = await client.queryCognitiveContext({
      query_type: 'beliefs',
      context: 'ship the feature',
    }, 'trace-123');

    expect(result.available).toBe(true);
    expect(result.value.beliefs[0].content).toBe('prefers reversible changes');
    expect(fetchImpl).toHaveBeenCalledWith('http://gbrain.local/cognitive/query', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-token',
        'X-GToM-Trace-Id': 'trace-123',
      }),
    }));
  });

  it('retries transient failures and degrades on invalid responses without throwing', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ wrong: true }));
    const client = new GBrainClient({
      endpoint: 'http://gbrain.local',
      fetchImpl,
      maxRetries: 1,
      retryBaseDelayMs: 0,
    });

    const result = await client.queryCognitiveContext({
      query_type: 'biases',
      context: 'limited offer',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.degraded).toBe(true);
    expect(result.value).toEqual({ beliefs: [], desires: [], intentions: [], biases: [] });
    expect(result.error).toBeDefined();
  });

  it('opens a circuit breaker after repeated gbrain failures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ error: 'down' }, 503));
    const client = new GBrainClient({
      endpoint: 'http://gbrain.local',
      fetchImpl,
      maxRetries: 0,
      retryBaseDelayMs: 0,
      circuitBreakerFailureThreshold: 2,
      circuitBreakerResetMs: 60_000,
    });

    await client.health();
    await client.health();
    const third = await client.health();

    expect(client.getCircuitState()).toBe('open');
    expect(third.degraded).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('supports MCP mode for gbrain calls', async () => {
    const callTool = jest.fn().mockResolvedValue({
      user_id: 'user-1',
      facts: [{ content: 'checks tradeoffs', confidence: 0.8 }],
    });
    const client = new GBrainClient({
      mode: 'mcp',
      mcpClient: { callTool },
    });

    const result = await client.whoKnows({ userId: 'user-1', limit: 5 });

    expect(result.available).toBe(true);
    expect(result.value.facts[0].content).toBe('checks tradeoffs');
    expect(callTool).toHaveBeenCalledWith('gbrain.whoknows', {
      userId: 'user-1',
      limit: 5,
    });
  });

  it('stores pages through typed API instead of shell execution', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      page_id: 'page-1',
      stored: true,
    }));
    const client = new GBrainClient({
      endpoint: 'http://gbrain.local',
      fetchImpl,
    });

    const result = await client.putPage({
      page_id: 'page-1',
      content: 'Verified page content',
      metadata: { source: 'test' },
    });

    expect(result.available).toBe(true);
    expect(result.value).toEqual({ page_id: 'page-1', stored: true });
    expect(fetchImpl).toHaveBeenCalledWith('http://gbrain.local/pages', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        page_id: 'page-1',
        content: 'Verified page content',
        metadata: { source: 'test' },
      }),
    }));
  });

  it('pulls gbrain context before GToM decision scoring', async () => {
    const fetchImpl = jest.fn((url: string) => {
      if (url.includes('/cognitive/query')) {
        return Promise.resolve(jsonResponse({
          beliefs: [{ content: 'values consent', confidence: 0.9, source: 'memory' }],
          desires: [{ content: 'avoid coercion', priority: 0.7 }],
          intentions: [],
          biases: [],
        }));
      }
      if (url.includes('/whoknows/user-1')) {
        return Promise.resolve(jsonResponse({
          user_id: 'user-1',
          facts: [{ content: 'prefers explicit approval', confidence: 0.8 }],
        }));
      }
      return Promise.resolve(jsonResponse({ healthy: true }));
    }) as jest.MockedFunction<typeof fetch>;
    const gbrainClient = new GBrainClient({
      endpoint: 'http://gbrain.local',
      fetchImpl,
      maxRetries: 0,
      retryBaseDelayMs: 0,
    });
    const gtom = new GToM({ gbrainClient });

    const score = await gtom.scoreDecisionAuthenticity({
      context: 'The user is being rushed into a choice',
      action: 'Ask for explicit confirmation',
      userId: 'user-1',
    });

    expect(score.score_id).toBeDefined();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/cognitive/query'))).toBe(true);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/whoknows/user-1'))).toBe(true);
  });
});
