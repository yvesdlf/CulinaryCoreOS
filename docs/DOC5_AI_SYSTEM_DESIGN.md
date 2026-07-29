# DOCUMENT 5: AI SYSTEM DESIGN

> **Status: original design intent, captured 2026-07-26.**
> Written before implementation began and not revised since. The build has
> since diverged in places — currency is IDR with Indonesian PPN rather than
> AED with VAT, and the schema has gained multi-tenancy and row level security.
> Treat this as the reasoning behind the design, not a description of what
> currently exists. `docs/PROGRESS.md` is the living record of what is built.


## CulinaryCore -- Embedded AI System Architecture

Version: 1.0
Classification: Internal -- Technical Architecture
Last Updated: 2026-07-25

---

## Table of Contents

1. [AI Architecture](#1-ai-architecture)
2. [AI Recipe Import System](#2-ai-recipe-import-system)
3. [AI Assistant Capabilities](#3-ai-assistant-capabilities)
4. [Prompt Engineering](#4-prompt-engineering)
5. [AI Data Pipeline](#5-ai-data-pipeline)
6. [Safety and Guardrails](#6-safety-and-guardrails)
7. [Future AI Capabilities](#7-future-ai-capabilities)

---

## 1. AI Architecture

### 1.1 Provider Abstraction Layer

CulinaryCore treats AI models as interchangeable services behind a unified interface. No application code references a specific provider directly. All AI interactions flow through the abstraction layer, which handles provider selection, request formatting, response normalization, error recovery, and cost tracking.

#### 1.1.1 Core Interface Design

```typescript
// The canonical interface every provider adapter must implement
interface AIProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  chat(request: AIChatRequest): Promise<AIChatResponse>;
  chatStream(request: AIChatRequest): AsyncIterable<AIChatStreamChunk>;
  embed(request: AIEmbedRequest): Promise<AIEmbedResponse>;
  vision(request: AIVisionRequest): Promise<AIVisionResponse>;

  estimateTokens(text: string): number;
  estimateCost(request: AIChatRequest): CostEstimate;

  healthCheck(): Promise<ProviderHealthStatus>;
}

interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  vision: boolean;
  embedding: boolean;
  functionCalling: boolean;
  jsonMode: boolean;
  maxContextWindow: number;       // in tokens
  maxOutputTokens: number;
  supportedLanguages: string[];
  onDevice: boolean;              // runs locally without network
  supportsOffline: boolean;
}

interface AIChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;           // 0.0 - 1.0
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };
  metadata?: {
    taskType: AITaskType;
    priority: 'low' | 'normal' | 'high' | 'critical';
    userId: string;
    organizationId: string;
    traceId: string;
  };
}

interface AIChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUSD: number;
  };
  model: string;
  provider: string;
  latencyMs: number;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}
```

#### 1.1.2 Provider Adapters

Each supported provider has an adapter that translates between the canonical interface and the provider's native API.

| Provider | Adapter | Primary Use Cases |
|---|---|---|
| Anthropic (Claude) | `AnthropicAdapter` | Complex reasoning, recipe analysis, cost optimization, document understanding |
| OpenAI | `OpenAIAdapter` | General-purpose tasks, embeddings (text-embedding-3-small), vision |
| Google Gemini | `GeminiAdapter` | Long-context tasks (large document import), multi-modal analysis |
| Azure OpenAI | `AzureOpenAIAdapter` | Enterprise deployments requiring Azure compliance, data residency |
| Apple Foundation Models | `AppleMLAdapter` | On-device inference, offline tasks, simple classification |
| Local LLMs (Ollama/llama.cpp) | `LocalLLMAdapter` | Development, privacy-sensitive tasks, offline fallback |

Each adapter is responsible for:

- Translating `AIChatRequest` into the provider's native request format (message structure, tool/function calling syntax, system prompt placement).
- Translating the provider's native response back into `AIChatResponse`.
- Handling provider-specific authentication (API keys, OAuth tokens, service accounts).
- Implementing provider-specific retry logic (respecting each provider's rate limit headers: `x-ratelimit-remaining`, `Retry-After`, etc.).
- Mapping provider-specific error codes to the canonical `AIError` hierarchy.

```typescript
// Adapter registration -- providers are discovered at startup
class AIProviderRegistry {
  private adapters: Map<string, AIProvider> = new Map();
  private healthStatus: Map<string, ProviderHealthStatus> = new Map();

  register(provider: AIProvider): void;
  get(providerId: string): AIProvider | undefined;
  getHealthy(capabilities?: Partial<ProviderCapabilities>): AIProvider[];
  
  // Periodic health checks (every 60 seconds)
  startHealthMonitor(intervalMs: number): void;
}
```

#### 1.1.3 Configuration

Provider configuration lives in the organization settings, not in code. Administrators configure which providers are available, set API keys (encrypted at rest in Supabase Vault), and define spending limits.

```typescript
interface AIProviderConfig {
  providerId: string;
  enabled: boolean;
  apiKey: string;                  // Reference to Supabase Vault secret
  baseUrl?: string;                // For Azure, local LLMs, or proxies
  organizationId?: string;         // Provider-level org ID (e.g., OpenAI org)
  defaultModel?: string;           // Override the tier's default model
  maxMonthlySpendUSD?: number;     // Hard spending cap
  rateLimitRPM?: number;           // Requests per minute cap
  region?: string;                 // For data residency requirements
}
```

### 1.2 Model Routing

Not every AI task requires the most capable (and most expensive) model. CulinaryCore classifies every AI request into a task type and routes it to the appropriate model tier.

#### 1.2.1 Task Classification and Tier Assignment

**Tier 1 -- On-Device (Apple Foundation Models / Local LLM)**
Cost: Zero (no API call). Latency: < 100ms. Availability: Always, including offline.

| Task | Description |
|---|---|
| Autocomplete | Ingredient name completion while typing |
| Unit detection | Recognizing "200g" as quantity=200, unit=grams |
| Simple classification | Categorizing a recipe as MAINS vs DESSERT |
| Spell correction | Fixing typos in ingredient names |
| Sentiment extraction | Extracting tone from user feedback |
| Search query expansion | Expanding "chicken" to include "poultry" |

**Tier 2 -- Small Cloud Model (e.g., Claude Haiku, GPT-4o-mini, Gemini Flash)**
Cost: ~$0.25 per 1M input tokens. Latency: 200-800ms.

| Task | Description |
|---|---|
| Ingredient parsing | Parsing "2 cups all-purpose flour, sifted" into structured data |
| Unit conversion | Converting between measurement systems with context |
| Simple Q&A | "What is the shelf life of CHIMICHURRI BASE?" |
| Text formatting | Standardizing recipe method wording |
| Allergen keyword detection | Scanning ingredient lists for known allergens |
| Cost explanation (simple) | "Why did this recipe's cost change?" with straightforward answers |
| Translation | Translating recipe text between languages |
| Summarization | Condensing recipe notes or supplier feedback |

**Tier 3 -- Large Cloud Model (e.g., Claude Sonnet, GPT-4o, Gemini Pro)**
Cost: ~$3 per 1M input tokens. Latency: 500ms-3s.

| Task | Description |
|---|---|
| Recipe import (structured docs) | Parsing Word/PDF recipes into structured data |
| Recipe creation | Generating complete recipes from natural language descriptions |
| Cost optimization | Suggesting ingredient substitutions to reduce food cost % |
| Ingredient substitution | Recommending alternatives with cost/nutrition analysis |
| Recipe scaling (non-linear) | Adjusting seasoning, leavening, and cooking times for different batch sizes |
| Nutrition analysis | Calculating and interpreting nutritional profiles |
| Production planning | Generating prep lists and production schedules |
| Supplier comparison | Analyzing supplier options across price, quality, reliability |

**Tier 4 -- Frontier Model (e.g., Claude Opus, GPT-4.5, Gemini Ultra)**
Cost: ~$15 per 1M input tokens. Latency: 2-10s. Reserved for tasks where reasoning quality materially affects business outcomes.

| Task | Description |
|---|---|
| Recipe import (complex/ambiguous) | Handwritten recipes, unusual formats, multi-recipe documents |
| Menu engineering | Holistic menu analysis across profitability, variety, dietary coverage |
| Multi-constraint optimization | "Reduce food cost to 22% while maintaining allergen-free, vegan options for 3 dishes" |
| HACCP document generation | Generating food safety documentation requiring domain expertise |
| Anomaly investigation | Investigating why costs spiked across multiple recipes simultaneously |
| Strategic recommendations | Seasonal menu planning, pricing strategy, waste reduction programs |

#### 1.2.2 Router Implementation

```typescript
class AIRouter {
  private tierConfigs: Map<AITier, TierConfig>;
  private taskTierMap: Map<AITaskType, AITier>;
  private providerRegistry: AIProviderRegistry;
  private costTracker: AICostTracker;

  async route(request: AIChatRequest): Promise<AIChatResponse> {
    const tier = this.resolveTier(request);
    const provider = this.selectProvider(tier, request);
    
    // Check spending limits before making the call
    const estimate = provider.estimateCost(request);
    await this.costTracker.checkBudget(request.metadata.organizationId, estimate);

    try {
      const response = await provider.chat(request);
      await this.costTracker.record(request.metadata, response.usage);
      return response;
    } catch (error) {
      return this.handleFailure(error, request, tier);
    }
  }

  private resolveTier(request: AIChatRequest): AITier {
    // Start with the default tier for this task type
    let tier = this.taskTierMap.get(request.metadata.taskType);

    // Upgrade tier if the input is complex
    if (this.isComplexInput(request)) {
      tier = Math.min(tier + 1, AITier.FRONTIER);
    }

    // Downgrade if budget is constrained
    if (this.costTracker.isNearLimit(request.metadata.organizationId)) {
      tier = Math.max(tier - 1, AITier.ON_DEVICE);
    }

    return tier;
  }

  private selectProvider(tier: AITier, request: AIChatRequest): AIProvider {
    const candidates = this.providerRegistry
      .getHealthy()
      .filter(p => this.tierConfigs.get(tier).providers.includes(p.providerId))
      .filter(p => this.meetsCapabilities(p, request));

    if (candidates.length === 0) {
      throw new NoAvailableProviderError(tier);
    }

    // Selection criteria: prefer the provider with lowest cost,
    // then lowest latency, then highest reliability score
    return this.rankProviders(candidates, request)[0];
  }
}
```

#### 1.2.3 Dynamic Tier Adjustment

The router can promote or demote requests based on runtime signals:

- **Complexity detection**: If a recipe import document has > 5 pages, mixed languages, or handwritten content, promote from Tier 3 to Tier 4.
- **Confidence feedback**: If a Tier 2 response has low confidence (self-reported or heuristic), re-route to Tier 3 automatically.
- **Budget pressure**: If the organization is at 80% of monthly spend, demote non-critical tasks by one tier.
- **Time sensitivity**: If the user is in a live service period (dinner rush), promote operational tasks (prep lists, shortage checks) to ensure fast response.

### 1.3 Fallback Chains

When a provider fails (network error, rate limit, outage, content filter), the system attempts the next provider in the fallback chain. Each tier defines an ordered list of fallback providers.

```typescript
interface FallbackChain {
  tier: AITier;
  primary: ProviderModelPair;
  fallbacks: ProviderModelPair[];
  maxAttempts: number;
  timeoutMs: number;
}

// Example fallback chains
const FALLBACK_CHAINS: FallbackChain[] = [
  {
    tier: AITier.SMALL,
    primary: { provider: 'anthropic', model: 'claude-haiku' },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4o-mini' },
      { provider: 'google', model: 'gemini-flash' },
      { provider: 'local', model: 'llama-3-8b' },
    ],
    maxAttempts: 3,
    timeoutMs: 10000,
  },
  {
    tier: AITier.LARGE,
    primary: { provider: 'anthropic', model: 'claude-sonnet' },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'google', model: 'gemini-pro' },
      { provider: 'azure', model: 'gpt-4o' },
    ],
    maxAttempts: 3,
    timeoutMs: 30000,
  },
  {
    tier: AITier.FRONTIER,
    primary: { provider: 'anthropic', model: 'claude-opus' },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4.5' },
      { provider: 'google', model: 'gemini-ultra' },
    ],
    maxAttempts: 2,
    timeoutMs: 60000,
  },
];
```

Fallback behavior:

- **Retryable errors** (429 rate limit, 503 service unavailable, network timeout): Retry with the same provider once using exponential backoff, then move to the next fallback.
- **Non-retryable errors** (401 auth failure, 400 bad request): Skip retry, move to next fallback immediately.
- **Content filter triggers**: Move to next fallback with modified prompt (remove potentially triggering content while preserving intent).
- **All fallbacks exhausted**: Return a graceful error to the user with an explanation and suggested manual action.

### 1.4 Cost Optimization

#### 1.4.1 Token Budget Management

Every AI request is evaluated for token efficiency before dispatch.

```typescript
class TokenOptimizer {
  // Truncate or summarize context that exceeds the budget
  async optimizeRequest(request: AIChatRequest, maxTokens: number): Promise<AIChatRequest> {
    const estimated = this.estimateTokens(request);
    
    if (estimated <= maxTokens) return request;

    // Strategy 1: Summarize long context sections
    const summarized = await this.summarizeContext(request, maxTokens);
    if (this.estimateTokens(summarized) <= maxTokens) return summarized;

    // Strategy 2: Remove low-priority context
    const trimmed = this.trimLowPriorityContext(summarized, maxTokens);
    if (this.estimateTokens(trimmed) <= maxTokens) return trimmed;

    // Strategy 3: Paginate -- process in chunks
    throw new ContextTooLargeError(estimated, maxTokens);
  }

  // Context prioritization for recipe tasks
  private contextPriority: Record<string, number> = {
    'current_recipe': 10,          // Always include
    'ingredient_costs': 9,         // Almost always needed
    'allergen_data': 9,            // Safety critical
    'sub_recipe_details': 8,       // Important for accuracy
    'nutrition_data': 7,           // Often needed
    'similar_recipes': 5,          // Nice to have
    'historical_costs': 4,         // Background context
    'supplier_details': 3,         // Rarely needed in full
    'organization_preferences': 2, // General context
  };
}
```

#### 1.4.2 Caching Strategy

Many AI tasks produce deterministic or near-deterministic results for identical inputs. Aggressive caching reduces both cost and latency.

| Cache Layer | TTL | Use Case |
|---|---|---|
| Exact match (hash of request) | 24 hours | Identical recipe analysis, repeated ingredient parsing |
| Semantic cache (embedding similarity > 0.98) | 4 hours | Similar questions about the same recipe |
| Embedding cache | 30 days | Pre-computed embeddings for products and recipes |
| Prompt template cache | Until template changes | Compiled system prompts with static context |

```typescript
class AIResponseCache {
  private exactCache: Map<string, CachedResponse>;     // In-memory LRU
  private semanticCache: VectorStore;                   // pgvector in Supabase
  
  async get(request: AIChatRequest): Promise<AIChatResponse | null> {
    // 1. Check exact match
    const hash = this.hashRequest(request);
    const exact = this.exactCache.get(hash);
    if (exact && !exact.isExpired()) return exact.response;

    // 2. Check semantic similarity (only for Q&A and explanation tasks)
    if (this.isCacheable(request.metadata.taskType)) {
      const embedding = await this.embed(request.messages);
      const similar = await this.semanticCache.search(embedding, {
        threshold: 0.98,
        limit: 1,
        filter: { taskType: request.metadata.taskType },
      });
      if (similar.length > 0) return similar[0].response;
    }

    return null;
  }

  // Tasks that should never be cached
  private nonCacheableTypes: Set<AITaskType> = new Set([
    'recipe_creation',        // Creative tasks should vary
    'cost_forecasting',       // Time-sensitive
    'production_planning',    // Depends on current state
    'shortage_prediction',    // Real-time data dependency
  ]);
}
```

#### 1.4.3 Cost Tracking and Budgeting

```typescript
interface AICostRecord {
  id: string;
  organizationId: string;
  userId: string;
  taskType: AITaskType;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  timestamp: Date;
  traceId: string;
  cached: boolean;
}

class AICostTracker {
  async checkBudget(organizationId: string, estimate: CostEstimate): Promise<void> {
    const monthlySpend = await this.getMonthlySpend(organizationId);
    const limit = await this.getMonthlyLimit(organizationId);

    if (monthlySpend + estimate.maxCostUSD > limit) {
      throw new BudgetExceededError(monthlySpend, limit, estimate);
    }

    // Warn at 80% threshold
    if (monthlySpend + estimate.maxCostUSD > limit * 0.8) {
      await this.notifyBudgetWarning(organizationId, monthlySpend, limit);
    }
  }

  // Dashboard data: cost breakdown by task type, provider, user, day
  async getCostReport(organizationId: string, dateRange: DateRange): Promise<CostReport>;
}
```

### 1.5 Rate Limiting and Quota Management

Rate limiting operates at three levels to prevent abuse and control costs.

#### 1.5.1 Rate Limit Hierarchy

```
Organization Level
  |-- Monthly spend cap (USD)
  |-- Requests per minute (RPM) across all users
  |-- Tokens per minute (TPM) across all users
  |
  +-- User Level
       |-- Requests per minute per user
       |-- Requests per hour per user
       |-- Daily token budget per user
       |
       +-- Task Level
            |-- Concurrent requests per task type
            |-- Cooldown between identical requests
```

#### 1.5.2 Implementation

```typescript
class AIRateLimiter {
  // Token bucket algorithm for RPM/TPM limits
  private buckets: Map<string, TokenBucket> = new Map();

  async acquire(request: AIChatRequest): Promise<RateLimitResult> {
    const orgKey = `org:${request.metadata.organizationId}`;
    const userKey = `user:${request.metadata.userId}`;
    const taskKey = `task:${request.metadata.taskType}`;

    // Check all levels -- fail fast at the most restrictive
    for (const key of [orgKey, userKey, taskKey]) {
      const bucket = this.buckets.get(key);
      if (bucket && !bucket.tryConsume(1)) {
        return {
          allowed: false,
          retryAfterMs: bucket.timeUntilRefill(),
          level: key.split(':')[0],
        };
      }
    }

    return { allowed: true };
  }
}
```

#### 1.5.3 Default Quotas

| Level | Metric | Free Tier | Professional | Enterprise |
|---|---|---|---|---|
| Organization | Monthly spend | $10 | $100 | Custom |
| Organization | RPM | 20 | 100 | 500 |
| User | RPM | 5 | 20 | 50 |
| User | Daily tokens | 50K | 500K | 2M |
| Task (import) | Concurrent | 1 | 3 | 10 |
| Task (Q&A) | RPM | 10 | 30 | 100 |

### 1.6 Offline AI Queue

CulinaryCore must function in environments with intermittent connectivity (kitchens, warehouses, remote locations). AI requests made while offline are queued locally and processed when connectivity returns.

#### 1.6.1 Queue Architecture

```typescript
interface QueuedAIRequest {
  id: string;
  request: AIChatRequest;
  priority: number;                 // Higher = process first
  createdAt: Date;
  expiresAt: Date;                  // Some requests become stale
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'expired';
  retryCount: number;
  maxRetries: number;
  result?: AIChatResponse;
  error?: string;
  callbackType: 'notification' | 'update_record' | 'none';
  callbackTarget?: string;          // Record ID to update when complete
}

class OfflineAIQueue {
  private queue: IndexedDB;          // Persistent local storage
  private syncManager: SyncManager;  // Service Worker background sync

  async enqueue(request: AIChatRequest): Promise<string> {
    const queuedRequest: QueuedAIRequest = {
      id: generateId(),
      request,
      priority: this.calculatePriority(request),
      createdAt: new Date(),
      expiresAt: this.calculateExpiry(request),
      status: 'queued',
      retryCount: 0,
      maxRetries: 3,
      callbackType: 'notification',
    };

    await this.queue.put('ai_requests', queuedRequest);
    
    // Register for background sync when connectivity returns
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('ai-queue-sync');
    }

    return queuedRequest.id;
  }

  // Process queue when online -- called by service worker sync event
  async processQueue(): Promise<void> {
    const pending = await this.queue.getAll('ai_requests', {
      index: 'status',
      value: 'queued',
      sort: 'priority',
      order: 'desc',
    });

    for (const item of pending) {
      if (item.expiresAt < new Date()) {
        await this.markExpired(item.id);
        continue;
      }

      try {
        await this.markProcessing(item.id);
        const response = await aiRouter.route(item.request);
        await this.markCompleted(item.id, response);
        await this.executeCallback(item);
      } catch (error) {
        if (item.retryCount < item.maxRetries) {
          await this.markQueued(item.id, item.retryCount + 1);
        } else {
          await this.markFailed(item.id, error.message);
        }
      }
    }
  }
}
```

#### 1.6.2 Priority and Expiry Rules

| Task Type | Priority | Expiry | Rationale |
|---|---|---|---|
| Allergen check | 10 (highest) | 7 days | Safety-critical, always relevant |
| Recipe import | 8 | 3 days | User is waiting for results |
| Cost recalculation | 7 | 1 day | Time-sensitive business data |
| Recipe optimization | 5 | 3 days | Useful but not urgent |
| Q&A | 3 | 6 hours | Context may be stale |
| Training/help | 2 | 1 hour | User likely moved on |
| Suggestions | 1 (lowest) | 30 minutes | Proactive, not requested |

#### 1.6.3 Offline User Experience

When the user triggers an AI action while offline:

1. Show a toast: "You're offline. This request has been queued and will process when you reconnect."
2. Display a subtle badge on the AI assistant icon showing the queue count.
3. For non-blocking tasks (optimization suggestions, Q&A), continue without the AI result and show a placeholder.
4. For blocking tasks (recipe import), show the queue status and estimated processing time.
5. When results arrive after reconnection, show a notification: "Your recipe import is ready for review."

### 1.7 On-Device AI (Apple Foundation Models)

On Apple platforms (macOS 26+, iPadOS 19+, iOS 19+), CulinaryCore leverages Apple Foundation Models for tasks that can run entirely on-device, providing zero-latency responses with complete privacy.

#### 1.7.1 Capabilities and Limitations

Apple Foundation Models are optimized for:
- Short text generation (< 500 tokens)
- Text classification and entity extraction
- Simple structured output (JSON with known schemas)
- Language detection and basic translation

They are not suitable for:
- Complex multi-step reasoning
- Large context windows (> 4K tokens)
- Vision/image understanding (use Apple Vision framework separately)
- Nuanced domain-specific analysis

#### 1.7.2 Integration Architecture

```swift
// Swift adapter for Apple Foundation Models (runs on-device)
@available(macOS 26.0, iOS 19.0, *)
class AppleFoundationModelAdapter: AIProviderProtocol {
    private let session: LanguageModelSession
    
    func chat(request: AIChatRequest) async throws -> AIChatResponse {
        let prompt = self.formatPrompt(request)
        
        // Use guided generation for structured output
        if request.responseFormat == .json {
            let schema = self.buildGenerationSchema(for: request.metadata.taskType)
            let response = try await session.respond(
                to: prompt,
                generating: schema
            )
            return self.parseResponse(response)
        }
        
        let response = try await session.respond(to: prompt)
        return AIChatResponse(
            content: response.content,
            usage: TokenUsage(inputTokens: 0, outputTokens: 0, costUSD: 0),
            model: "apple-foundation",
            provider: "apple",
            latencyMs: response.latencyMs,
            finishReason: .stop
        )
    }
    
    // Example: Ingredient name autocomplete
    func autocompleteIngredient(
        partial: String,
        knownProducts: [String]
    ) async throws -> [String] {
        let prompt = """
        Complete this ingredient name. Return only valid completions
        from the provided list, ranked by likelihood.
        
        Partial: \(partial)
        Known products: \(knownProducts.joined(separator: ", "))
        """
        // Response in < 50ms on-device
        let response = try await session.respond(to: prompt)
        return self.parseCompletions(response.content)
    }
}
```

#### 1.7.3 On-Device Task Routing

The `AIRouter` checks device capability before routing to cloud:

```typescript
class AIRouter {
  async route(request: AIChatRequest): Promise<AIChatResponse> {
    // Try on-device first for eligible tasks
    if (this.isOnDeviceEligible(request)) {
      const appleAdapter = this.providerRegistry.get('apple');
      if (appleAdapter?.capabilities.onDevice) {
        try {
          return await appleAdapter.chat(request);
        } catch {
          // Fall through to cloud if on-device fails
        }
      }
    }
    
    // Cloud routing as before
    return this.routeToCloud(request);
  }

  private isOnDeviceEligible(request: AIChatRequest): boolean {
    const eligible: Set<AITaskType> = new Set([
      'autocomplete',
      'unit_detection',
      'simple_classification',
      'spell_correction',
      'search_query_expansion',
    ]);
    return eligible.has(request.metadata.taskType)
      && this.estimateTokens(request) < 4000;
  }
}
```

### 1.8 Privacy and Data Handling

#### 1.8.1 Data Classification

All data in CulinaryCore is classified into privacy tiers that determine what can be sent to external AI providers.

| Tier | Examples | May Leave Device? | Requires Consent? |
|---|---|---|---|
| Public | Standard unit conversions, generic cooking knowledge | Yes | No |
| Business | Recipe names, ingredient lists, method steps, cost data | Yes | Organization admin consent (one-time) |
| Sensitive | Supplier contracts, pricing agreements, customer data | Cloud only with enterprise agreement | Explicit per-request |
| Restricted | User credentials, payment information, personal health data | Never | N/A |

#### 1.8.2 Data Minimization

Before sending any request to a cloud AI provider, the system strips unnecessary data:

```typescript
class PrivacyFilter {
  sanitize(request: AIChatRequest, orgPolicy: PrivacyPolicy): AIChatRequest {
    const sanitized = structuredClone(request);

    // Remove fields that are never needed by AI
    this.stripUserPII(sanitized);         // Names, emails, phone numbers
    this.stripFinancialDetails(sanitized); // Bank accounts, payment methods
    this.stripInternalIds(sanitized);      // Database IDs replaced with opaque refs

    // Apply organization-specific policies
    if (orgPolicy.anonymizeSuppliers) {
      this.anonymizeSupplierNames(sanitized); // "Supplier A", "Supplier B"
    }
    if (orgPolicy.anonymizeRecipeNames) {
      this.anonymizeRecipeNames(sanitized);
    }
    if (orgPolicy.redactCosts) {
      this.redactAbsoluteCosts(sanitized);    // Use ratios instead of AED values
    }

    return sanitized;
  }
}
```

#### 1.8.3 Provider Data Policies

| Provider | Zero Data Retention | SOC 2 | GDPR | Data Region Control |
|---|---|---|---|---|
| Anthropic | Yes (API) | Yes | Yes | US/EU |
| OpenAI | Yes (API, with opt-out) | Yes | Yes | US |
| Google Gemini | Yes (API) | Yes | Yes | US/EU/APAC |
| Azure OpenAI | Yes | Yes | Yes | 30+ regions |
| Apple Foundation | N/A (on-device) | N/A | N/A | N/A |
| Local LLM | N/A (on-device) | N/A | N/A | N/A |

The organization administrator selects which providers are acceptable for their data sensitivity requirements. The system enforces these selections at the router level.

#### 1.8.4 Audit Logging

Every AI request and response is logged (with configurable retention):

```typescript
interface AIAuditLog {
  traceId: string;
  timestamp: Date;
  userId: string;
  organizationId: string;
  taskType: AITaskType;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  // The actual prompt and response are stored ONLY if the
  // organization has enabled "AI interaction logging"
  promptHash: string;               // Always stored for deduplication
  prompt?: string;                   // Optional, encrypted at rest
  response?: string;                 // Optional, encrypted at rest
  dataTier: 'public' | 'business' | 'sensitive';
  latencyMs: number;
  costUSD: number;
  cached: boolean;
  success: boolean;
  errorCode?: string;
}
```

---

## 2. AI Recipe Import System

The recipe import system is one of CulinaryCore's highest-value AI features. It transforms unstructured recipe documents into fully structured, costed, and nutrition-analyzed recipes in the database. The system must handle the full spectrum of input quality, from professionally formatted Word documents to photographs of handwritten recipe cards.

### 2.1 Import Pipeline Overview

```
Input Document
  |
  v
[Format Detection] --> Determine file type and processing strategy
  |
  v
[Content Extraction] --> Extract raw text (and images if applicable)
  |
  v
[Structure Recognition] --> Identify recipe boundaries and sections
  |
  v
[Entity Extraction] --> Parse ingredients, method steps, metadata
  |
  v
[Normalization] --> Standardize units, quantities, terminology
  |
  v
[Product Matching] --> Match ingredients to database products
  |
  v
[Sub Recipe Detection] --> Identify ingredients that are sub recipes
  |
  v
[Ambiguity Resolution] --> Flag low-confidence items for user review
  |
  v
[Cost Calculation] --> Apply waste factors, costs, margins
  |
  v
[Nutrition Calculation] --> Compute nutritional profile
  |
  v
[Review UI] --> Present structured recipe for user confirmation
  |
  v
[Database Insert] --> Save confirmed recipe
```

### 2.2 Format-Specific Parsing Strategies

#### 2.2.1 Word Documents (.docx)

Word documents are the richest source format because they preserve structural hints (headings, bold text, tables, lists).

**Extraction strategy:**
1. Parse the .docx file using a library (e.g., `mammoth` for JS, or server-side `python-docx` via Edge Function).
2. Extract the document structure: headings (H1, H2, H3), paragraphs, tables, lists (ordered and unordered), bold/italic runs, images.
3. Preserve the hierarchy: H1 typically indicates a recipe title, H2 indicates sections (Ingredients, Method), H3 indicates sub-sections.

**Structure recognition heuristics:**

| Signal | Interpretation |
|---|---|
| H1 or first bold line | Recipe title |
| H2 "Ingredients" or bullet list before numbered list | Ingredients section |
| H2 "Method" / "Instructions" / "Procedure" or numbered list | Method section |
| Table with columns (Qty, Unit, Ingredient) | Structured ingredient table |
| "Yield:" / "Serves:" / "Portions:" | Yield/portion data |
| "Prep time:" / "Cook time:" / "Total time:" | Timing data |
| Temperature mentions (180C, 350F, Gas Mark 6) | Cooking temperatures |
| "Chef's notes" / "Tips" / "Variations" | Notes section |

**Implementation:**

```typescript
class DocxParser {
  async parse(file: ArrayBuffer): Promise<RawRecipeDocument> {
    const result = await mammoth.convertToHtml(file, {
      styleMap: [
        "p[style-name='Heading 1'] => h1",
        "p[style-name='Heading 2'] => h2",
        "p[style-name='Heading 3'] => h3",
      ],
    });

    const dom = parseHTML(result.value);
    
    return {
      format: 'docx',
      sections: this.extractSections(dom),
      tables: this.extractTables(dom),
      images: this.extractImages(file),
      metadata: this.extractMetadata(file),  // Author, created date, etc.
      rawText: dom.textContent,
    };
  }

  private extractSections(dom: Document): DocumentSection[] {
    // Walk the DOM tree, splitting on H1/H2 boundaries
    // Each H1 starts a new recipe
    // Each H2 starts a new section within the recipe
    const sections: DocumentSection[] = [];
    let currentSection: DocumentSection | null = null;

    for (const node of dom.body.childNodes) {
      if (node.tagName === 'H1') {
        // New recipe boundary
        currentSection = { type: 'title', content: node.textContent, children: [] };
        sections.push(currentSection);
      } else if (node.tagName === 'H2') {
        currentSection = { type: this.classifySection(node.textContent), content: node.textContent, children: [] };
        sections.push(currentSection);
      } else if (currentSection) {
        currentSection.children.push(this.nodeToContent(node));
      }
    }

    return sections;
  }

  private classifySection(heading: string): SectionType {
    const lower = heading.toLowerCase().trim();
    const patterns: [RegExp, SectionType][] = [
      [/^(ingredients?|mise en place|components?)$/i, 'ingredients'],
      [/^(method|instructions?|procedure|directions?|preparation|steps?)$/i, 'method'],
      [/^(notes?|tips?|chef.?s? notes?|variations?)$/i, 'notes'],
      [/^(equipment|tools|mise en place)$/i, 'equipment'],
      [/^(garnish|plating|presentation)$/i, 'garnish'],
    ];
    for (const [pattern, type] of patterns) {
      if (pattern.test(lower)) return type;
    }
    return 'unknown';
  }
}
```

#### 2.2.2 PDF Files

PDF parsing is more challenging because PDFs store visual layout, not semantic structure. The strategy depends on whether the PDF contains selectable text or is a scanned image.

**Detection step:** Attempt text extraction. If the extracted text is empty or mostly garbled, treat as scanned/image-based and route to OCR.

**Text-based PDF extraction:**
1. Use a PDF parsing library (e.g., `pdf-parse` for JS, or `PyMuPDF`/`pdfplumber` via Edge Function) to extract text with position coordinates.
2. Use spatial analysis to reconstruct the reading order (PDFs do not guarantee text order matches visual order).
3. Detect columns (recipes are often printed in 2-column layouts).
4. Detect tables by analyzing aligned text blocks.
5. Detect headings by font size and weight differences.

**Scanned/image-based PDF extraction:**
1. Render each page to an image at 300 DPI.
2. Route to the OCR pipeline (Section 2.2.5).
3. Apply post-OCR structure recognition.

```typescript
class PdfParser {
  async parse(file: ArrayBuffer): Promise<RawRecipeDocument> {
    const textContent = await this.extractText(file);
    
    if (this.isScannedPdf(textContent)) {
      // Convert pages to images and use OCR
      const images = await this.renderPages(file, { dpi: 300 });
      return this.ocrPipeline.processImages(images);
    }

    // Text-based PDF
    const blocks = this.extractTextBlocks(file);
    const columns = this.detectColumns(blocks);
    const sections = this.reconstructStructure(columns);

    return {
      format: 'pdf',
      sections,
      tables: this.extractTables(blocks),
      images: this.extractEmbeddedImages(file),
      rawText: textContent,
    };
  }

  private isScannedPdf(text: string): boolean {
    // If extracted text is very short relative to page count,
    // or has a high proportion of garbled characters, it is scanned
    const meaningfulChars = text.replace(/\s+/g, '').length;
    return meaningfulChars < 50;  // Per page threshold
  }

  private extractTextBlocks(file: ArrayBuffer): TextBlock[] {
    // Each block has: text, x, y, width, height, fontSize, fontWeight
    // This spatial information is used to reconstruct layout
  }

  private detectColumns(blocks: TextBlock[]): TextColumn[] {
    // Cluster blocks by x-coordinate to detect multi-column layouts
    // Blocks within 20px x-range are in the same column
  }
}
```

#### 2.2.3 Plain Text (.txt)

Plain text has no formatting metadata. Structure recognition relies entirely on textual patterns.

**Heuristics for structure recognition:**

| Pattern | Interpretation |
|---|---|
| First non-empty line (often ALL CAPS or Title Case) | Recipe title |
| Lines matching `^\d+[\./]?\s+\w+` or `^[-*]\s+\w+` | Ingredient list items |
| Lines matching `^\d+[\.)]\s+[A-Z]` | Numbered method steps |
| Empty line between groups of lines | Section boundary |
| Lines containing only `---` or `===` | Explicit section dividers |
| Lines with quantity patterns (`200g`, `1 cup`, `2 tbsp`) | Ingredient lines |
| Lines with verb-first sentences ("Preheat", "Mix", "Fold") | Method steps |
| "Yield:", "Serves:", "Makes:" | Yield data |
| Time patterns ("30 minutes", "1 hour", "45 mins") | Timing data |

```typescript
class PlainTextParser {
  async parse(content: string): Promise<RawRecipeDocument> {
    const lines = content.split('\n').map(l => l.trim());
    const blocks = this.splitIntoBlocks(lines);  // Split on empty lines

    // Use AI to classify ambiguous structures
    const classified = await this.classifyWithAI(blocks);

    return {
      format: 'txt',
      sections: classified.sections,
      tables: [],
      images: [],
      rawText: content,
    };
  }

  private splitIntoBlocks(lines: string[]): string[][] {
    const blocks: string[][] = [];
    let current: string[] = [];

    for (const line of lines) {
      if (line === '') {
        if (current.length > 0) {
          blocks.push(current);
          current = [];
        }
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) blocks.push(current);

    return blocks;
  }
}
```

#### 2.2.4 Images (Photos of Recipes)

Photographs of handwritten or printed recipes require vision AI capabilities.

**Processing pipeline:**
1. **Image preprocessing**: Auto-rotate (using EXIF orientation), deskew, enhance contrast, remove noise.
2. **Layout analysis**: Detect text regions vs. images/illustrations. Detect columns, tables, and section boundaries.
3. **OCR** (see Section 2.2.5): Extract text from detected regions.
4. **Handwriting recognition**: If the text region appears handwritten (stroke analysis), use a handwriting-specific model or prompt.
5. **Post-processing**: Spell correction, quantity validation, structure assembly.

```typescript
class ImageRecipeParser {
  async parse(imageData: ArrayBuffer, mimeType: string): Promise<RawRecipeDocument> {
    // Preprocess the image
    const processed = await this.preprocess(imageData);

    // Use vision model to extract recipe content
    const visionResponse = await aiRouter.route({
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            data: processed,
            mimeType,
          },
          {
            type: 'text',
            text: RECIPE_IMAGE_EXTRACTION_PROMPT,
          },
        ],
      }],
      systemPrompt: RECIPE_IMPORT_SYSTEM_PROMPT,
      responseFormat: 'json',
      metadata: {
        taskType: 'recipe_import_vision',
        priority: 'normal',
      },
    });

    return this.parseVisionResponse(visionResponse);
  }

  private async preprocess(imageData: ArrayBuffer): Promise<ArrayBuffer> {
    // 1. Read EXIF and auto-rotate
    // 2. Convert to grayscale if low color variation (likely B&W scan)
    // 3. Apply adaptive thresholding for contrast enhancement
    // 4. Deskew using Hough transform line detection
    // 5. Crop to content bounds
    return processedImageData;
  }
}
```

#### 2.2.5 OCR Processing

OCR is used for scanned PDFs and image-based recipes. CulinaryCore uses a multi-strategy approach.

**Strategy selection:**

| Input | Strategy |
|---|---|
| Clean printed text (high contrast, standard fonts) | On-device OCR (Apple Vision framework / Tesseract.js) |
| Handwritten text | Cloud vision AI (GPT-4o vision, Claude vision, Gemini vision) |
| Mixed printed + handwritten | Cloud vision AI with layout analysis |
| Low quality / damaged | Cloud vision AI at Tier 4 (frontier model) |

**On-device OCR (Apple Vision framework):**

```swift
@available(macOS 26.0, iOS 19.0, *)
class AppleOCRProcessor {
    func recognizeText(in image: CGImage) async throws -> [RecognizedTextBlock] {
        let request = RecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en", "fr", "ar"]  // Common in hospitality
        request.usesLanguageCorrection = true

        let observations = try await request.perform(on: image)
        
        return observations.map { observation in
            RecognizedTextBlock(
                text: observation.topCandidates(3).map { $0.string },
                confidence: observation.topCandidates(1).first?.confidence ?? 0,
                boundingBox: observation.boundingBox,
            )
        }
    }
}
```

**Cloud vision AI (for complex inputs):**

The cloud vision approach sends the image directly to a multi-modal model with a specialized prompt that instructs the model to:
1. Identify all text regions in the image.
2. Determine reading order.
3. Classify each region (title, ingredient, method step, note).
4. Extract and structure the content as JSON.

This approach often outperforms traditional OCR followed by NLP because the vision model understands context simultaneously with character recognition.

### 2.3 Ingredient Parsing

Once raw text is extracted, each ingredient line must be parsed into structured data: quantity, unit, product name, and preparation notes.

#### 2.3.1 Parsing Architecture

```typescript
interface ParsedIngredient {
  rawText: string;                   // Original line as extracted
  quantity: number | null;           // Numeric quantity (null if "to taste")
  unit: string | null;               // Standardized unit code
  productName: string;               // Cleaned product name
  preparation: string | null;        // "diced", "julienned", "room temperature"
  qualifier: string | null;          // "fresh", "frozen", "organic"
  isOptional: boolean;               // "optional" mentioned
  confidence: number;                // 0.0 - 1.0 parsing confidence
  alternatives: ParsedIngredient[];  // Alternative parses if ambiguous
}
```

#### 2.3.2 Parsing Examples

| Raw Text | Quantity | Unit | Product | Preparation | Confidence |
|---|---|---|---|---|---|
| "200g butter, softened" | 200 | g | butter | softened | 0.99 |
| "2 cups all-purpose flour, sifted" | 2 | cup | all-purpose flour | sifted | 0.97 |
| "1 large onion, finely diced" | 1 | piece | onion (large) | finely diced | 0.95 |
| "salt and pepper to taste" | null | null | salt; pepper | to taste | 0.90 |
| "juice of 2 lemons" | 2 | piece | lemon | juiced | 0.88 |
| "a handful of fresh basil" | 1 | handful | basil | fresh | 0.75 |
| "chimichurri base (see recipe)" | 1 | batch | CHIMICHURRI BASE | (sub recipe) | 0.92 |

#### 2.3.3 Multi-Stage Parsing

**Stage 1: Rule-based pre-parse (on-device, instant)**

```typescript
class IngredientPreParser {
  private patterns = {
    // Match: optional quantity + optional unit + product name + optional prep
    standard: /^(\d+[\d\/\.\s]*)?(\s*(?:g|kg|ml|l|cup|cups|tbsp|tsp|oz|lb|piece|pieces|bunch|bunches|clove|cloves|sprig|sprigs|handful|pinch)s?)?\s+(.+?)(?:,\s*(.+))?$/i,
    
    // "juice of 2 lemons" pattern
    ofPattern: /^(.+?)\s+of\s+(\d+[\d\/\.\s]*)\s+(.+?)(?:,\s*(.+))?$/i,
    
    // "2 x 400g cans chopped tomatoes"
    canPattern: /^(\d+)\s*x\s*(\d+)(g|ml)\s+(cans?|tins?|packets?|bags?)\s+(.+?)(?:,\s*(.+))?$/i,
    
    // "salt and pepper to taste"
    toTastePattern: /^(.+?)\s+to\s+taste$/i,
  };

  preParse(line: string): ParsedIngredient {
    // Try each pattern in order
    for (const [name, pattern] of Object.entries(this.patterns)) {
      const match = line.match(pattern);
      if (match) return this.buildFromMatch(name, match);
    }
    // No pattern matched -- return with low confidence
    return { rawText: line, productName: line, confidence: 0.3 };
  }
}
```

**Stage 2: AI-assisted parsing (for low-confidence results)**

Lines with confidence below 0.8 are sent to an AI model for parsing. The AI receives the line along with context (surrounding lines, recipe title) to disambiguate.

```typescript
class AIIngredientParser {
  async parse(
    lines: string[],
    context: { recipeTitle: string; cuisine: string }
  ): Promise<ParsedIngredient[]> {
    const response = await aiRouter.route({
      messages: [{
        role: 'user',
        content: `Parse these ingredient lines into structured data:\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
      }],
      systemPrompt: INGREDIENT_PARSING_SYSTEM_PROMPT,
      responseFormat: 'json',
      metadata: { taskType: 'ingredient_parsing', priority: 'normal' },
    });

    return this.validateAndMerge(response);
  }
}
```

### 2.4 Unit Normalization

CulinaryCore stores all quantities in metric base units internally (grams for mass, milliliters for volume) and converts for display based on user preferences.

#### 2.4.1 Conversion Tables

```typescript
const UNIT_CONVERSIONS: Record<string, { baseUnit: string; factor: number }> = {
  // Mass
  'g':      { baseUnit: 'g', factor: 1 },
  'kg':     { baseUnit: 'g', factor: 1000 },
  'oz':     { baseUnit: 'g', factor: 28.3495 },
  'lb':     { baseUnit: 'g', factor: 453.592 },
  
  // Volume
  'ml':     { baseUnit: 'ml', factor: 1 },
  'l':      { baseUnit: 'ml', factor: 1000 },
  'cl':     { baseUnit: 'ml', factor: 10 },
  'dl':     { baseUnit: 'ml', factor: 100 },
  'tsp':    { baseUnit: 'ml', factor: 4.929 },
  'tbsp':   { baseUnit: 'ml', factor: 14.787 },
  'fl oz':  { baseUnit: 'ml', factor: 29.5735 },
  'cup':    { baseUnit: 'ml', factor: 236.588 },
  'pint':   { baseUnit: 'ml', factor: 473.176 },
  'quart':  { baseUnit: 'ml', factor: 946.353 },
  'gallon': { baseUnit: 'ml', factor: 3785.41 },
  
  // Count
  'piece':  { baseUnit: 'piece', factor: 1 },
  'dozen':  { baseUnit: 'piece', factor: 12 },
  
  // Imprecise (converted to approximate metric)
  'pinch':    { baseUnit: 'g', factor: 0.36 },
  'handful':  { baseUnit: 'g', factor: 30 },
  'bunch':    { baseUnit: 'piece', factor: 1 },
  'sprig':    { baseUnit: 'piece', factor: 1 },
  'clove':    { baseUnit: 'piece', factor: 1 },
};
```

#### 2.4.2 Context-Aware Conversion

Some conversions require knowing the ingredient (volume to mass depends on density):

```typescript
const DENSITY_MAP: Record<string, number> = {
  // grams per ml
  'flour':       0.593,
  'sugar':       0.845,
  'butter':      0.911,
  'honey':       1.420,
  'olive oil':   0.918,
  'milk':        1.030,
  'cream':       1.012,
  'rice':        0.850,
  'salt':        1.217,
  'water':       1.000,
};

class UnitNormalizer {
  normalize(parsed: ParsedIngredient): NormalizedIngredient {
    const conversion = UNIT_CONVERSIONS[parsed.unit];
    if (!conversion) {
      // Unknown unit -- flag for user review
      return { ...parsed, needsReview: true, reviewReason: 'unknown_unit' };
    }

    let quantity = parsed.quantity * conversion.factor;
    let unit = conversion.baseUnit;

    // If converting volume to mass (recipe asks for cups of flour),
    // look up density
    if (unit === 'ml' && this.shouldConvertToMass(parsed.productName)) {
      const density = this.lookupDensity(parsed.productName);
      if (density) {
        quantity = quantity * density;
        unit = 'g';
      }
    }

    return { ...parsed, quantity, unit, normalized: true };
  }
}
```

### 2.5 Product Matching

After parsing ingredients, each must be matched against the existing product database (657+ products). This is a critical step that directly affects cost calculation accuracy.

#### 2.5.1 Matching Strategy

Product matching uses a multi-stage approach, from exact to fuzzy:

```typescript
class ProductMatcher {
  async match(
    ingredient: ParsedIngredient,
    products: Product[]
  ): Promise<ProductMatch[]> {
    const candidates: ProductMatch[] = [];

    // Stage 1: Exact name match (case-insensitive)
    const exact = products.filter(
      p => p.name.toLowerCase() === ingredient.productName.toLowerCase()
    );
    if (exact.length > 0) {
      return exact.map(p => ({ product: p, confidence: 1.0, matchType: 'exact' }));
    }

    // Stage 2: Normalized name match (remove plurals, common suffixes)
    const normalizedName = this.normalizeProductName(ingredient.productName);
    const normalized = products.filter(
      p => this.normalizeProductName(p.name) === normalizedName
    );
    if (normalized.length > 0) {
      return normalized.map(p => ({ product: p, confidence: 0.95, matchType: 'normalized' }));
    }

    // Stage 3: Token overlap (handles word order differences)
    const tokenMatches = this.tokenOverlapMatch(ingredient.productName, products);
    candidates.push(...tokenMatches.filter(m => m.confidence >= 0.7));

    // Stage 4: Fuzzy string matching (Levenshtein distance)
    const fuzzyMatches = this.fuzzyMatch(ingredient.productName, products);
    candidates.push(...fuzzyMatches.filter(m => m.confidence >= 0.6));

    // Stage 5: Embedding similarity (semantic matching)
    if (candidates.length === 0 || candidates[0].confidence < 0.8) {
      const embeddingMatches = await this.embeddingMatch(ingredient, products);
      candidates.push(...embeddingMatches);
    }

    // Deduplicate and sort by confidence
    return this.deduplicateAndRank(candidates);
  }

  private normalizeProductName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(fresh|frozen|dried|organic|local)\b/g, '')  // Remove qualifiers
      .replace(/\b(large|medium|small|baby)\b/g, '')            // Remove sizes
      .replace(/s\b/g, '')                                       // Remove plurals
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenOverlapMatch(name: string, products: Product[]): ProductMatch[] {
    const queryTokens = new Set(this.tokenize(name));
    
    return products
      .map(product => {
        const productTokens = new Set(this.tokenize(product.name));
        const intersection = new Set([...queryTokens].filter(t => productTokens.has(t)));
        const union = new Set([...queryTokens, ...productTokens]);
        const jaccard = intersection.size / union.size;
        return { product, confidence: jaccard, matchType: 'token_overlap' as const };
      })
      .filter(m => m.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  private async embeddingMatch(
    ingredient: ParsedIngredient,
    products: Product[]
  ): Promise<ProductMatch[]> {
    // Use pre-computed product embeddings stored in pgvector
    const queryEmbedding = await aiRouter.embed({
      text: `${ingredient.productName} ${ingredient.qualifier || ''} ${ingredient.preparation || ''}`,
      metadata: { taskType: 'product_matching' },
    });

    const results = await vectorStore.search('product_embeddings', queryEmbedding, {
      limit: 5,
      threshold: 0.7,
    });

    return results.map(r => ({
      product: r.metadata as Product,
      confidence: r.similarity,
      matchType: 'embedding',
    }));
  }
}
```

#### 2.5.2 Confidence Thresholds and Actions

| Confidence Range | Action |
|---|---|
| 0.95 - 1.00 | Auto-match, no user intervention needed |
| 0.80 - 0.94 | Auto-match but highlight in review UI for confirmation |
| 0.60 - 0.79 | Present top 3 candidates for user selection |
| 0.40 - 0.59 | Present candidates + option to create new product |
| 0.00 - 0.39 | No match found. Prompt user to select or create product |

### 2.6 Sub Recipe Detection

Sub recipes are a critical concept in CulinaryCore. An ingredient in one recipe may itself be a recipe (e.g., "CHIMICHURRI BASE" or "PASTA DOUGH"). The import system must detect these references.

#### 2.6.1 Detection Strategies

```typescript
class SubRecipeDetector {
  async detect(
    ingredients: ParsedIngredient[],
    existingSubRecipes: SubRecipe[]  // 245 sub recipes in the database
  ): Promise<SubRecipeDetectionResult[]> {
    const results: SubRecipeDetectionResult[] = [];

    for (const ingredient of ingredients) {
      // Strategy 1: Direct name match against sub recipe database
      const directMatch = existingSubRecipes.find(
        sr => sr.name.toLowerCase() === ingredient.productName.toLowerCase()
      );
      if (directMatch) {
        results.push({
          ingredient,
          subRecipe: directMatch,
          confidence: 1.0,
          detectionMethod: 'direct_match',
        });
        continue;
      }

      // Strategy 2: Fuzzy match against sub recipe names
      const fuzzyMatch = this.fuzzyMatchSubRecipes(ingredient.productName, existingSubRecipes);
      if (fuzzyMatch && fuzzyMatch.confidence > 0.8) {
        results.push({
          ingredient,
          subRecipe: fuzzyMatch.subRecipe,
          confidence: fuzzyMatch.confidence,
          detectionMethod: 'fuzzy_match',
        });
        continue;
      }

      // Strategy 3: Textual cues that suggest this is a sub recipe
      if (this.hasSubRecipeCues(ingredient)) {
        results.push({
          ingredient,
          subRecipe: null,  // Might be a new sub recipe not yet in the database
          confidence: 0.7,
          detectionMethod: 'textual_cue',
          suggestedAction: 'create_sub_recipe',
        });
        continue;
      }

      // Not a sub recipe
      results.push({
        ingredient,
        subRecipe: null,
        confidence: 0.0,
        detectionMethod: 'none',
      });
    }

    return results;
  }

  private hasSubRecipeCues(ingredient: ParsedIngredient): boolean {
    const cues = [
      /\(see recipe\)/i,
      /\(see page\s*\d+\)/i,
      /\(recipe follows\)/i,
      /\(recipe below\)/i,
      /\bhomemade\b/i,
      /\bhouse[-\s]?made\b/i,
      /\bprepared\b/i,
      /\bbase\b/i,           // "chimichurri base"
      /\bmix\b/i,            // "spice mix"
      /\bdough\b/i,          // "pasta dough"
      /\bstock\b/i,          // "chicken stock" (if homemade)
      /\bsauce\b/i,          // Could be purchased or made
      /\bmousse\b/i,         // "ginger mousse" -- likely sub recipe
      /\bbisque\b/i,         // "bisque" -- likely sub recipe
    ];
    return cues.some(cue => cue.test(ingredient.rawText));
  }
}
```

### 2.7 Ambiguity Handling

When the AI system cannot resolve an ambiguity with sufficient confidence, it must not guess. Instead, it presents the ambiguity to the user through a structured review interface.

#### 2.7.1 Ambiguity Types

| Ambiguity | Example | Resolution Strategy |
|---|---|---|
| Product match | "cream" could be heavy cream, light cream, sour cream, cream cheese | Present candidates ranked by context |
| Quantity | "2-3 cloves garlic" -- is it 2 or 3? | Default to lower, flag for review |
| Unit | "1 can tomatoes" -- what size can? (400g? 800g?) | Ask user to specify, suggest common size |
| Preparation | "onion, chopped" -- does chopped affect yield/waste? | Apply standard waste percentage, flag |
| Sub recipe vs product | "mayonnaise" -- homemade sub recipe or purchased product? | Ask user, check if sub recipe exists |
| Recipe boundary | Multiple recipes in one document -- where does one end and another begin? | Use heading/formatting cues, then ask |
| Temperature unit | "350 degrees" -- Fahrenheit or Celsius? | Infer from context (cuisine, other temps), ask if unsure |
| Duplicate ingredient | "butter" mentioned twice in different sections | Merge or keep separate depending on context |

#### 2.7.2 Ambiguity Resolution Queue

```typescript
interface AmbiguityItem {
  id: string;
  recipeImportId: string;
  type: AmbiguityType;
  description: string;              // Human-readable explanation
  context: string;                   // Surrounding text for context
  options: AmbiguityOption[];        // Possible resolutions
  defaultOption?: string;            // AI's best guess (pre-selected)
  confidence: number;                // AI's confidence in the default
  resolved: boolean;
  resolvedOptionId?: string;
  resolvedBy?: string;               // User ID
  resolvedAt?: Date;
}

interface AmbiguityOption {
  id: string;
  label: string;                     // "Heavy cream (CREAM HEAVY 1L)"
  description?: string;              // "AED 12.50 per liter, from Supplier A"
  value: any;                        // The structured data this option represents
  isCreateNew?: boolean;             // "Create new product" option
}
```

### 2.8 Missing Product Creation Workflow

When an ingredient cannot be matched to any existing product, the user must create a new product entry. The AI assists by pre-filling as much information as possible.

```typescript
class NewProductAssistant {
  async suggestProductDetails(
    ingredient: ParsedIngredient,
    context: { cuisine: string; category: string }
  ): Promise<SuggestedProduct> {
    const response = await aiRouter.route({
      messages: [{
        role: 'user',
        content: `Suggest product database details for: "${ingredient.rawText}"`,
      }],
      systemPrompt: PRODUCT_CREATION_SYSTEM_PROMPT,
      responseFormat: 'json',
      metadata: { taskType: 'product_creation_assist', priority: 'normal' },
    });

    return {
      name: this.standardizeProductName(ingredient.productName),
      category: response.suggestedCategory,
      defaultUnit: response.suggestedUnit,
      estimatedCostPerUnit: response.estimatedCost,     // Flagged as estimate
      yieldPercentage: response.estimatedYield,
      wastePercentage: response.estimatedWaste,
      nutrition: response.estimatedNutrition,            // Flagged as estimate
      allergens: response.identifiedAllergens,
      shelfLife: response.estimatedShelfLife,
      storageConditions: response.suggestedStorage,
      needsVerification: true,                           // All AI-estimated fields flagged
    };
  }
}
```

The UI presents the suggested product details with all AI-estimated fields clearly marked. The user must confirm or correct each field before the product is saved. AI-estimated costs are never used in final cost calculations until verified by a user.

### 2.9 Batch Import

When a document contains multiple recipes (common in recipe books, menu specifications, or corporate recipe binders), the system must detect recipe boundaries and process each recipe independently.

#### 2.9.1 Recipe Boundary Detection

```typescript
class RecipeBoundaryDetector {
  detect(document: RawRecipeDocument): RecipeBoundary[] {
    const boundaries: RecipeBoundary[] = [];

    // Strategy 1: Heading-based (H1 = new recipe)
    if (document.sections.filter(s => s.type === 'title').length > 1) {
      return this.splitOnHeadings(document);
    }

    // Strategy 2: Page-based (one recipe per page, common in PDF)
    if (document.format === 'pdf' && this.isOneRecipePerPage(document)) {
      return this.splitOnPages(document);
    }

    // Strategy 3: AI-assisted boundary detection
    return this.aiDetectBoundaries(document);
  }
}
```

#### 2.9.2 Batch Import Workflow

1. Upload document(s) -- user can upload multiple files at once.
2. System detects N recipes across all documents.
3. Show summary: "Found 12 recipes in 3 documents. Processing..."
4. Process each recipe through the import pipeline in parallel.
5. Show batch review screen:
   - Recipe cards showing title, ingredient count, detected issues.
   - Status badges: "Ready" (no issues), "Needs Review" (ambiguities), "Failed" (unparseable).
   - Ability to review and fix each recipe individually.
   - "Import All Ready" button for recipes with no issues.
6. After import, show summary of results.

### 2.10 Import Review and Confirmation UI Flow

The import review UI is a critical user experience. It must let the user efficiently verify the AI's work, correct mistakes, and confirm the import.

#### 2.10.1 Review Screen Layout

```
+------------------------------------------------------------------+
|  RECIPE IMPORT REVIEW                              [Import] [Cancel] |
+------------------------------------------------------------------+
|                                                                      |
|  Recipe Title: [Grilled Lamb Rack with Herb Crust    ] (editable)   |
|  Category:     [MAINS v]    Yield: [4] portions                     |
|  Prep: [30 min]  Cook: [25 min]  Total: [55 min]                   |
|                                                                      |
|  INGREDIENTS                                          CONFIDENCE     |
|  +------+------+---------------------------+---------+-----------+  |
|  | Qty  | Unit | Product                   | Cost/u  | Match     |  |
|  +------+------+---------------------------+---------+-----------+  |
|  | 800  | g    | LAMB RACK FRENCHED        | 45.00   | [100%]    |  |
|  | 30   | g    | FRESH ROSEMARY            | 2.50    | [ 95%]    |  |
|  | 20   | g    | FRESH THYME               | 2.50    | [ 95%]    |  |
|  | 100  | g    | BREADCRUMBS PANKO         | 8.00    | [ 87%] *  |  |
|  |  50  | g    | DIJON MUSTARD             | 12.00   | [ 72%] ** |  |
|  |   5  | g    | GARLIC PASTE              | 6.00    | [ 45%] ***|  |
|  +------+------+---------------------------+---------+-----------+  |
|                                                                      |
|  * Highlighted: AI matched "panko crumbs" to "BREADCRUMBS PANKO"    |
|  ** Needs confirmation: 3 mustard products found                     |
|  *** Low confidence: "garlic" -- did you mean GARLIC FRESH,         |
|      GARLIC PASTE, or GARLIC POWDER?                                 |
|                                                                      |
|  METHOD                                                              |
|  1. Preheat oven to 200C (fan) / 220C (conventional)               |
|  2. Season the lamb rack with salt and pepper                        |
|  3. Sear on all sides in a hot pan with olive oil (2 min/side)      |
|  4. Brush with Dijon mustard                                        |
|  5. Press herb-breadcrumb mixture onto the mustard coating           |
|  6. Roast for 20-25 minutes for medium-rare                         |
|  7. Rest for 10 minutes before carving                               |
|                                                                      |
|  ORIGINAL DOCUMENT (side-by-side comparison)                         |
|  [Shows the original source text for reference]                      |
|                                                                      |
|  CALCULATED COSTS                                                    |
|  Total cost: AED 52.30  |  Per portion: AED 13.08                   |
|  Food cost %: 26.2% (at menu price AED 50.00)                       |
|                                                                      |
+------------------------------------------------------------------+
```

#### 2.10.2 Review Interactions

- **Click on a product match**: Opens a dropdown with alternative products from the database, ranked by match score.
- **Click "Create New"**: Opens new product creation form, pre-filled by AI.
- **Edit quantity/unit**: Inline editing with immediate cost recalculation.
- **Drag to reorder**: Reorder method steps.
- **Split/merge ingredients**: If the AI incorrectly merged or split ingredient lines.
- **Side-by-side view**: Original document text alongside structured output for verification.
- **"Accept All Suggestions"**: For experienced users who trust the AI's work.

---

## 3. AI Assistant Capabilities

### 3.1 Recipe Intelligence

#### 3.1.1 Recipe Creation from Natural Language

Users describe a dish in natural language, and the AI generates a complete, structured, costed recipe.

**Input examples:**
- "Create a lamb tagine for 6 people, keep it under 30% food cost"
- "I need a vegan dessert using coconut and mango, suitable for a fine dining menu"
- "Make a kids menu pasta dish, simple, under AED 8 food cost per portion"

**Processing pipeline:**

1. **Intent parsing**: Extract constraints (cuisine, dietary, cost target, portion count, category, skill level).
2. **Recipe generation**: Generate recipe using AI with the full product database as context (summarized to fit token limits).
3. **Product matching**: Map each generated ingredient to an actual product in the database.
4. **Cost calculation**: Calculate total cost, per-portion cost, food cost %.
5. **Constraint validation**: Check if the generated recipe meets all stated constraints.
6. **Iteration**: If constraints are not met (e.g., cost too high), prompt the AI to adjust.
7. **Presentation**: Show the recipe in the standard review UI for user confirmation.

```typescript
class RecipeCreator {
  async create(description: string, constraints: RecipeConstraints): Promise<DraftRecipe> {
    // Gather context
    const availableProducts = await this.getProductSummary();
    const existingSubRecipes = await this.getSubRecipeSummary();
    const similarRecipes = await this.findSimilarRecipes(description);

    // Generate recipe
    const response = await aiRouter.route({
      messages: [{
        role: 'user',
        content: `Create a recipe: ${description}\n\nConstraints: ${JSON.stringify(constraints)}`,
      }],
      systemPrompt: this.buildSystemPrompt(availableProducts, existingSubRecipes, similarRecipes),
      responseFormat: 'json',
      metadata: { taskType: 'recipe_creation', priority: 'normal' },
    });

    const draft = this.parseRecipeResponse(response);

    // Match generated ingredients to real products
    draft.ingredients = await Promise.all(
      draft.ingredients.map(async (ing) => {
        const matches = await productMatcher.match(ing, availableProducts);
        return { ...ing, productMatch: matches[0] };
      })
    );

    // Calculate costs
    draft.costs = await costCalculator.calculate(draft);

    // Check constraints
    draft.constraintViolations = this.checkConstraints(draft, constraints);

    // If cost constraint violated, ask AI to optimize
    if (draft.constraintViolations.some(v => v.type === 'cost_exceeded')) {
      return this.optimizeForCost(draft, constraints);
    }

    return draft;
  }
}
```

#### 3.1.2 Recipe Optimization (Cost Reduction)

The AI analyzes a recipe and suggests modifications to reduce food cost while maintaining quality and character.

**Optimization strategies the AI considers:**
- Substitute expensive ingredients with cheaper alternatives (e.g., thyme instead of saffron for color).
- Adjust ratios (reduce the most expensive ingredient, increase cheaper fillers).
- Suggest sub recipe batching (making a component in bulk is cheaper per unit).
- Identify seasonal alternatives (in-season produce is cheaper).
- Suggest portion size adjustments.
- Recommend different cuts or grades of protein.

**Output format:**

```typescript
interface OptimizationSuggestion {
  id: string;
  type: 'substitute' | 'ratio_adjust' | 'batch' | 'seasonal' | 'portion' | 'grade';
  description: string;
  currentIngredient: IngredientRef;
  suggestedChange: {
    ingredient?: ProductRef;
    quantity?: number;
    unit?: string;
  };
  costImpact: {
    currentCostAED: number;
    newCostAED: number;
    savingsAED: number;
    savingsPercent: number;
  };
  qualityImpact: 'none' | 'minimal' | 'noticeable' | 'significant';
  qualityNotes: string;
  nutritionImpact: NutritionDelta;
  confidence: number;
}
```

The user sees a ranked list of suggestions with projected savings. They can accept individual suggestions, preview the combined effect, and apply selected changes.

#### 3.1.3 Ingredient Substitution Suggestions

When a user needs to replace an ingredient (out of stock, dietary requirement, cost reduction), the AI suggests alternatives with full impact analysis.

**Request context provided to the AI:**
- The complete recipe (all ingredients, method, yield).
- The ingredient to substitute and the reason for substitution.
- Available products in the database with costs.
- Dietary and allergen constraints.
- The recipe's category and cuisine style.

**Response structure:**

```typescript
interface SubstitutionSuggestion {
  originalIngredient: IngredientRef;
  substitute: ProductRef;
  substituteQuantity: number;
  substituteUnit: string;
  rationale: string;                // Why this substitute works
  methodAdjustments: string[];      // Changes needed to the cooking method
  costDelta: number;                // Positive = more expensive
  nutritionDelta: NutritionProfile;
  allergenChanges: {
    added: string[];
    removed: string[];
  };
  flavorImpact: string;             // Description of flavor change
  textureImpact: string;
  confidenceScore: number;
}
```

#### 3.1.4 Recipe Scaling with Intelligent Adjustments

Linear scaling (multiply everything by N) works for most ingredients but fails for:
- **Seasonings and spices**: Scale sub-linearly (doubling a recipe does not require double the salt).
- **Leavening agents**: Scale sub-linearly (doubling baking powder does not produce a better rise).
- **Cooking times**: Do not scale linearly (a double batch does not take double the time).
- **Cooking temperatures**: Generally unchanged but may need adjustment for larger volumes.
- **Emulsions and sauces**: May need technique changes at larger scales (e.g., making hollandaise in smaller batches).
- **Gelatin and setting agents**: Scale differently depending on surface-area-to-volume ratio.

```typescript
interface ScalingResult {
  originalPortions: number;
  targetPortions: number;
  scaleFactor: number;
  ingredients: ScaledIngredient[];
  methodAdjustments: MethodAdjustment[];
  timingAdjustments: TimingAdjustment[];
  warnings: ScalingWarning[];
}

interface ScaledIngredient {
  original: IngredientRef;
  scaledQuantity: number;
  scalingMethod: 'linear' | 'sublinear' | 'custom';
  scalingNote?: string;            // "Reduced scaling factor for salt: 0.8x instead of 2x"
}

interface MethodAdjustment {
  stepNumber: number;
  originalText: string;
  adjustedText: string;
  reason: string;
}
```

#### 3.1.5 Consistency Checking

The AI validates internal consistency of a recipe:

**Checks performed:**

| Check | Description | Example Issue |
|---|---|---|
| Method-ingredient match | Every ingredient in the list appears in the method, and vice versa | "Butter listed in ingredients but never used in method" |
| Timing realism | Total of step times roughly matches stated total time | "Steps total 90 minutes but recipe says 'Total time: 30 min'" |
| Temperature realism | Temperatures are appropriate for the cooking method | "Broil at 100C is too low" |
| Yield plausibility | Total ingredient weight is plausible for stated yield | "2kg of ingredients for 1 portion seems excessive" |
| Order logic | Steps are in logical order | "Step 3 says 'add the diced onions' but dicing is in step 5" |
| Missing equipment | Equipment implied by method but not listed | "Method says 'blend until smooth' but no blender in equipment" |
| Allergen consistency | Declared allergens match actual ingredients | "Recipe marked dairy-free but contains butter" |

```typescript
interface ConsistencyCheckResult {
  recipeId: string;
  checks: ConsistencyCheck[];
  overallScore: number;             // 0-100
  criticalIssues: ConsistencyCheck[];
  warnings: ConsistencyCheck[];
  suggestions: ConsistencyCheck[];
}

interface ConsistencyCheck {
  type: ConsistencyCheckType;
  severity: 'critical' | 'warning' | 'suggestion';
  message: string;
  details: string;
  affectedSteps?: number[];
  affectedIngredients?: string[];
  suggestedFix?: string;
}
```

#### 3.1.6 Recipe Wording Improvement

The AI standardizes recipe language to professional culinary standards:

- Replace vague instructions with precise ones ("cook until done" becomes "cook until internal temperature reaches 74C").
- Standardize terminology ("sautee" to "saute", "carmelize" to "caramelize").
- Add safety-relevant details ("cool to below 5C within 2 hours").
- Ensure consistent tense and voice (imperative mood: "Dice the onions" not "The onions are diced").
- Add timing cues where missing ("approximately 3-4 minutes" instead of "until golden").
- Ensure measurements are precise ("a knob of butter" becomes "15g butter").

### 3.2 Cost Intelligence

#### 3.2.1 Cost Explanation

When a recipe's cost changes, the AI can explain why in natural language.

**Input context:**
- Recipe with current and previous cost snapshots.
- Product price history for all ingredients.
- Any recent recipe modifications.

**Example output:**
> "The cost of GRILLED LAMB RACK increased by AED 8.50 (16.3%) since last month. The primary driver is LAMB RACK FRENCHED, which increased from AED 42/kg to AED 49/kg (a 16.7% increase from your supplier). This single ingredient accounts for AED 7.00 of the increase. Additionally, FRESH ROSEMARY increased by AED 0.50/bunch. The remaining AED 1.00 comes from the 5% security margin applied to the higher base cost."

#### 3.2.2 Cost Forecasting

The AI analyzes historical cost data to predict future ingredient costs.

```typescript
interface CostForecast {
  recipeId: string;
  currentCostAED: number;
  forecasts: {
    period: '1_month' | '3_months' | '6_months';
    predictedCostAED: number;
    confidenceInterval: { low: number; high: number };
    majorDrivers: {
      productName: string;
      currentPriceAED: number;
      predictedPriceAED: number;
      trend: 'rising' | 'stable' | 'falling';
      confidence: number;
    }[];
  }[];
  recommendations: string[];        // "Consider locking in lamb prices with a forward contract"
}
```

**Data sources for forecasting:**
- Internal price history (price changes recorded in CulinaryCore).
- Seasonal patterns (historical prices by month/quarter).
- Supplier-provided price lists and announced increases.
- General commodity trends (if integrated with market data feeds).

#### 3.2.3 Sensitivity Analysis

"What if ingredient X price rises by Y%?" The AI computes the cascading impact.

```typescript
interface SensitivityAnalysis {
  scenario: {
    product: ProductRef;
    priceChangePercent: number;
  };
  impactedRecipes: {
    recipeId: string;
    recipeName: string;
    currentCostAED: number;
    newCostAED: number;
    costChangeAED: number;
    costChangePercent: number;
    currentFoodCostPercent: number;
    newFoodCostPercent: number;
    usesSubRecipeContaining: boolean;  // Indirect impact via sub recipe
  }[];
  totalImpactAED: number;             // Across all affected recipes
  recommendations: string[];
}
```

This analysis is particularly valuable because it follows sub recipe chains: if CREAM HEAVY increases in price, it affects every sub recipe that uses cream, and every recipe that uses those sub recipes.

#### 3.2.4 Target Cost Achievement

"How do I get this recipe under 25% food cost?"

The AI works backward from the target:

1. Calculate the maximum allowable food cost in AED (menu price * target %).
2. Identify the gap between current cost and target.
3. Rank ingredients by cost contribution (highest first).
4. For each high-cost ingredient, evaluate substitution, reduction, or elimination options.
5. Present a combination of changes that achieves the target.

```typescript
interface TargetCostPlan {
  recipeName: string;
  currentFoodCostPercent: number;
  targetFoodCostPercent: number;
  menuPriceAED: number;
  currentCostAED: number;
  targetCostAED: number;
  gapAED: number;
  
  plan: {
    changes: CostReductionStep[];
    achievesTarget: boolean;
    projectedCostAED: number;
    projectedFoodCostPercent: number;
    qualityAssessment: string;
  };
  
  alternativePlans?: {
    changes: CostReductionStep[];
    projectedCostAED: number;
    tradeoffs: string;
  }[];
}
```

### 3.3 Supplier Intelligence

#### 3.3.1 Supplier Recommendations

When adding a new product or reviewing existing suppliers, the AI suggests suppliers based on:

- **Price competitiveness**: Compared across suppliers for the same or equivalent products.
- **Quality history**: Based on recorded quality issues, returns, rejections.
- **Reliability**: On-time delivery rate, order accuracy.
- **Minimum order quantities (MOQs)**: Whether the organization's usage meets the MOQ.
- **Payment terms**: Net 30, Net 60, COD, etc.
- **Location and delivery logistics**: Proximity, delivery schedule alignment.
- **Product range**: Can this supplier also supply other needed items (reducing total supplier count)?

#### 3.3.2 Purchase Optimization

The AI analyzes current purchasing patterns and suggests optimizations:

```typescript
interface PurchaseOptimization {
  recommendations: {
    type: 'consolidate' | 'split' | 'moq' | 'timing' | 'substitute';
    description: string;
    currentCostAED: number;
    optimizedCostAED: number;
    savingsAED: number;
    implementation: string;           // Steps to implement
    risk: string;                     // What could go wrong
  }[];
  totalPotentialSavingsAED: number;
  implementationEffort: 'low' | 'medium' | 'high';
}
```

**Example recommendations:**
- "Consolidate your dairy orders: you currently order from 3 dairy suppliers. Moving all dairy to Supplier B would save AED 450/month and simplify receiving."
- "You are ordering 5kg of saffron per month, just below Supplier C's 6kg MOQ for the bulk price. Increasing your monthly order by 1kg would reduce unit cost by 18% and save AED 120/month."

### 3.4 Nutrition and Allergen Intelligence

#### 3.4.1 Allergen Checking and Warnings

Allergen safety is the highest-priority AI function. The system must be more cautious than any other capability.

**The 14 major allergens tracked (EU standard, commonly used in UAE):**
Celery, Cereals containing gluten, Crustaceans, Eggs, Fish, Lupin, Milk, Molluscs, Mustard, Tree nuts, Peanuts, Sesame, Soybeans, Sulphur dioxide/sulphites.

```typescript
class AllergenChecker {
  async check(recipe: Recipe): Promise<AllergenCheckResult> {
    const results: AllergenCheckResult = {
      confirmedAllergens: [],
      possibleAllergens: [],
      crossContaminationRisks: [],
      warnings: [],
    };

    for (const ingredient of recipe.ingredients) {
      const product = await this.getProduct(ingredient.productId);
      
      // Confirmed allergens from product database
      for (const allergen of product.allergens) {
        results.confirmedAllergens.push({
          allergen,
          source: product.name,
          certainty: 'confirmed',
        });
      }

      // AI-detected potential allergens not in the database
      // (e.g., product marked as allergen-free but name suggests otherwise)
      const aiCheck = await this.aiAllergenCheck(product, ingredient);
      if (aiCheck.possibleAllergens.length > 0) {
        results.warnings.push({
          severity: 'high',
          message: `AI detected possible ${aiCheck.possibleAllergens.join(', ')} in "${product.name}" that is not recorded in the product database. Please verify.`,
          requiresHumanReview: true,
        });
      }
    }

    // Check sub recipes recursively
    for (const subRecipeRef of recipe.subRecipes) {
      const subResult = await this.check(subRecipeRef.recipe);
      results.confirmedAllergens.push(...subResult.confirmedAllergens);
      results.possibleAllergens.push(...subResult.possibleAllergens);
    }

    return results;
  }
}
```

**Critical rule**: The AI can ADD allergen warnings but can NEVER remove them. Removing an allergen from a recipe or product requires explicit human confirmation with a reason recorded in the audit trail.

#### 3.4.2 Dietary Modification Suggestions

"Make this recipe vegan" or "Can this be made gluten-free?"

The AI analyzes the recipe and suggests modifications:

```typescript
interface DietaryModification {
  targetDiet: 'vegan' | 'vegetarian' | 'gluten_free' | 'dairy_free' | 'nut_free' | 'halal' | 'kosher';
  feasibility: 'straightforward' | 'possible_with_changes' | 'significant_changes' | 'not_feasible';
  modifications: {
    originalIngredient: IngredientRef;
    substitute: ProductRef | null;
    substituteQuantity: number;
    notes: string;
    costImpact: number;
  }[];
  methodChanges: string[];
  qualityAssessment: string;
  warningNotes: string[];            // "The texture will differ significantly from the original"
}
```

#### 3.4.3 Nutritional Analysis and Recommendations

The AI interprets nutritional data in context:

- Compare recipe nutrition against RDA (Recommended Daily Allowance) percentages.
- Identify nutritional strengths ("This recipe provides 45% of daily iron requirements").
- Identify nutritional concerns ("This recipe contains 180% of daily sodium -- consider reducing salt").
- Suggest modifications to improve nutritional balance.
- Generate nutrition labels for menu compliance.

### 3.5 Operational Intelligence

#### 3.5.1 Production Schedule Generation

Given a set of recipes and quantities needed for a specific date/service, the AI generates a production schedule.

**Inputs:**
- Recipes and quantities (e.g., 40 covers of LAMB RACK, 30 covers of GRILLED SALMON).
- Available equipment (2 ovens, 1 blast chiller, 4 burners).
- Available staff and skill levels.
- Service time (dinner at 19:00).

**Output:**

```typescript
interface ProductionSchedule {
  date: Date;
  serviceTime: string;
  tasks: ProductionTask[];
  timeline: TimelineEntry[];
  equipmentPlan: EquipmentAllocation[];
  criticalPath: string[];            // Tasks that cannot be delayed
  totalPrepHours: number;
  suggestedStartTime: string;
}

interface ProductionTask {
  id: string;
  recipeName: string;
  taskDescription: string;
  assignedTo?: string;
  startTime: string;
  endTime: string;
  duration: number;                   // minutes
  dependencies: string[];             // Task IDs that must complete first
  equipment: string[];
  priority: 'critical' | 'high' | 'normal';
  notes: string;
}
```

#### 3.5.2 Prep List Generation

Generate actionable prep lists from production plans:

```typescript
interface PrepList {
  date: Date;
  sections: PrepSection[];
  shoppingListRef: string;           // Link to generated shopping list
}

interface PrepSection {
  station: string;                    // "Hot station", "Pastry", "Garde manger"
  items: PrepItem[];
}

interface PrepItem {
  ingredient: string;
  totalQuantity: number;
  unit: string;
  preparation: string;               // "Brunoise", "Julienne", "Blanch and shock"
  usedIn: string[];                   // Recipe names
  priority: 'critical' | 'normal';
  shelfLife: string;                  // "Use within 2 hours", "Good for 3 days"
  storageInstructions: string;
}
```

#### 3.5.3 Shopping List and Purchasing Recommendations

Aggregate ingredient needs across all production plans and generate purchasing recommendations:

- Total quantity needed per product (aggregated across all recipes).
- Current inventory levels (if inventory module is active).
- Net quantity to order.
- Preferred supplier and unit cost.
- Pack size alignment (round up to whole cases/packs).
- MOQ compliance.
- Delivery lead time considerations.

#### 3.5.4 Menu Price Suggestions

Based on food cost targets, the AI suggests menu prices:

```typescript
interface MenuPriceSuggestion {
  recipeId: string;
  recipeName: string;
  foodCostAED: number;
  suggestions: {
    targetFoodCostPercent: number;    // 25%, 28%, 30%, 33%
    suggestedPriceAED: number;
    roundedPriceAED: number;          // Rounded to nearest 5 or psychological pricing
    competitiveAnalysis?: string;     // If market data available
  }[];
  currentMenuPrice?: number;
  recommendation: string;
}
```

### 3.6 Knowledge and Training

#### 3.6.1 Natural Language Q&A

Users can ask questions in natural language and get answers grounded in their actual data.

**Example queries and expected behavior:**

| Query | Data Sources | Response Approach |
|---|---|---|
| "What is the most expensive ingredient in our LAMB RACK recipe?" | Recipe ingredients + product costs | Direct lookup, no AI needed for simple cases |
| "Which recipes use saffron?" | Recipe-ingredient relationships | Database query, formatted by AI |
| "Why is our food cost trending up this quarter?" | Cost snapshots over time, product price changes | AI analysis of trends with specific data points |
| "How does our GINGER MOUSSE compare to industry standard?" | Sub recipe data + AI general knowledge | Hybrid: factual data + AI context |
| "Can you explain what GP% means?" | AI general knowledge | Pure AI response, no data needed |

**Implementation:**

```typescript
class NaturalLanguageQA {
  async answer(question: string, context: UserContext): Promise<QAResponse> {
    // Step 1: Classify the question
    const classification = await this.classifyQuestion(question);

    // Step 2: Determine what data is needed
    const dataNeeds = this.identifyDataNeeds(classification);

    // Step 3: Fetch relevant data
    const data = await this.fetchData(dataNeeds, context);

    // Step 4: Generate answer
    const response = await aiRouter.route({
      messages: [
        { role: 'user', content: question },
      ],
      systemPrompt: this.buildQASystemPrompt(data, context),
      metadata: { taskType: 'qa', priority: 'normal' },
    });

    return {
      answer: response.content,
      dataSources: dataNeeds,         // Show user what data was referenced
      confidence: this.assessConfidence(response),
      followUpSuggestions: this.generateFollowUps(question, classification),
    };
  }
}
```

#### 3.6.2 Training and Contextual Help

The AI provides contextual guidance for new users:

- **Guided tours**: Step-by-step walkthroughs of key workflows.
- **Contextual tooltips**: Hover over a metric (e.g., "Food Cost %") to get an AI-generated explanation relevant to the current data.
- **"Explain this"**: User can ask the AI to explain any screen, chart, or metric.
- **Best practices**: Proactive suggestions based on user behavior ("You have 12 recipes with food cost above 35%. Would you like help optimizing them?").

#### 3.6.3 HACCP Documentation Generation

The AI generates Hazard Analysis and Critical Control Points documentation:

- Identify potential hazards for each recipe (biological, chemical, physical).
- Determine Critical Control Points (CCPs).
- Set critical limits (temperatures, times).
- Establish monitoring procedures.
- Define corrective actions.
- Generate record-keeping templates.
- Output in compliance with local food safety regulations (UAE municipality standards).

---

## 4. Prompt Engineering

### 4.1 System Prompts

All AI interactions use carefully crafted system prompts that establish the AI's role, capabilities, constraints, and output format. System prompts are versioned and A/B tested.

#### 4.1.1 Master System Prompt (Base)

This prompt is prepended to every AI request in the system:

```
You are CulinaryCore AI, an expert culinary and food service management
assistant embedded in a professional recipe and cost management platform.

ROLE:
- You assist chefs, kitchen managers, and food service operators with
  recipe management, cost control, nutrition analysis, and operational
  planning.
- You are precise, professional, and safety-conscious.
- You never guess at allergen information -- when uncertain, you flag
  items for human review.
- You ground all cost-related answers in the actual data provided.
  Never fabricate prices or costs.

CONTEXT:
- The platform manages recipes, sub recipes, products (ingredients),
  suppliers, and costs.
- Costs are in AED (UAE Dirhams) unless otherwise specified.
- A 5% security margin is applied to all recipe costs.
- Products have yield/waste percentages that affect nett-to-gross
  conversions.
- Sub recipes are batch-costed components used within recipes.

OUTPUT RULES:
- When returning structured data, use the exact JSON schema specified
  in the user message.
- When returning explanations, be concise but complete.
- Always cite specific data points (product names, prices, quantities)
  rather than making general statements.
- If you cannot answer with the provided data, say so explicitly.
  Never fabricate information.
- Format currency as "AED X.XX" with two decimal places.
- Format percentages as "X.X%" with one decimal place.
```

#### 4.1.2 Task-Specific System Prompts

Each AI capability has an additional system prompt that extends the base.

**Recipe Import System Prompt:**

```
TASK: Recipe Import and Structuring

You are parsing a recipe document into structured data. The document may
be a Word file, PDF, plain text, or image.

EXTRACTION RULES:
1. Extract the recipe title. If no explicit title exists, infer from
   the first line or the dish description.
2. Extract all ingredients as structured data:
   - quantity (number or null for "to taste")
   - unit (standardize to: g, kg, ml, l, piece, bunch, sprig, clove,
     tbsp, tsp, cup)
   - product_name (the ingredient name, cleaned of preparation notes)
   - preparation (any prep instructions: "diced", "julienned", etc.)
   - is_optional (true if marked as optional)
3. Extract method steps as an ordered list. Each step should be one
   discrete action.
4. Extract metadata: yield/portions, prep time, cook time, total time,
   temperatures, category, cuisine.
5. Extract any notes, tips, or variations.

AMBIGUITY HANDLING:
- If a quantity is a range (e.g., "2-3"), use the lower value and note
  the range.
- If a unit is ambiguous or missing, flag with confidence < 0.8.
- If an ingredient could be a sub recipe (contains words like "base",
  "dough", "stock", "sauce", "mousse", "bisque", or "see recipe"),
  flag it as a potential sub recipe.
- If the document contains multiple recipes, return each as a separate
  object in the array.

OUTPUT: Return valid JSON matching the RecipeImportSchema.
```

**Cost Optimization System Prompt:**

```
TASK: Recipe Cost Optimization

You are analyzing a recipe to suggest cost reductions while maintaining
dish quality and character.

AVAILABLE DATA:
- Complete recipe with ingredients, quantities, and costs
- Product database with alternative products and their costs
- Sub recipe details with their costs
- Historical cost data if available

RULES:
1. Never suggest removing a defining ingredient (e.g., don't remove
   lamb from a lamb dish).
2. Rank suggestions by savings potential (highest first).
3. For each suggestion, quantify:
   - Exact cost savings in AED
   - Impact on dish quality (none/minimal/noticeable/significant)
   - Any allergen changes
   - Any nutrition changes
4. Consider sub recipe optimization as well (a cheaper sub recipe
   reduces cost for all recipes using it).
5. Be realistic about culinary substitutions. A chef knows when
   substitutions change the dish character.
6. Always preserve food safety requirements.

OUTPUT: Return valid JSON matching the OptimizationSuggestionsSchema.
```

**Allergen Check System Prompt:**

```
TASK: Allergen Verification

You are performing an allergen safety check on a recipe.

CRITICAL SAFETY RULES:
1. You MUST identify every potential allergen. False negatives are
   dangerous.
2. When in doubt, flag as a POSSIBLE allergen. It is always safer to
   over-report than under-report.
3. Check both direct ingredients and sub recipe components recursively.
4. Consider hidden allergens:
   - Worcestershire sauce contains FISH (anchovies)
   - Many breads contain MILK and EGGS
   - Soy sauce contains SOYBEANS and sometimes WHEAT (gluten)
   - Some chocolates contain MILK and may contain TREE NUTS
   - "Natural flavoring" may contain any allergen
5. Check for cross-contamination risks based on shared equipment or
   preparation areas.
6. You can ADD allergen warnings but NEVER remove existing ones.

THE 14 MAJOR ALLERGENS:
Celery, Cereals containing gluten (wheat, rye, barley, oats, spelt),
Crustaceans, Eggs, Fish, Lupin, Milk (lactose), Molluscs, Mustard,
Tree nuts (almonds, hazelnuts, walnuts, cashews, pecans, brazil nuts,
pistachios, macadamia nuts), Peanuts, Sesame, Soybeans,
Sulphur dioxide and sulphites (> 10mg/kg or 10mg/l)

OUTPUT: Return valid JSON matching the AllergenCheckSchema.
```

### 4.2 Context Injection Strategy

AI prompts are most effective when they include relevant, specific data rather than general context. The context injection system determines what data to include in each prompt.

#### 4.2.1 Context Categories and Priority

```typescript
interface ContextInjection {
  category: string;
  priority: number;          // Higher = more important to include
  tokenEstimate: number;     // Estimated tokens this context uses
  data: any;
  formatter: (data: any) => string;  // Format data for the prompt
}

class ContextBuilder {
  private maxTokenBudget: number;

  async buildContext(
    taskType: AITaskType,
    entityId: string,
    customContext?: any
  ): Promise<string> {
    // Determine which context categories are relevant for this task
    const relevantCategories = TASK_CONTEXT_MAP[taskType];
    
    // Fetch data for each category
    const contexts: ContextInjection[] = await Promise.all(
      relevantCategories.map(cat => this.fetchContext(cat, entityId))
    );

    // Sort by priority (highest first)
    contexts.sort((a, b) => b.priority - a.priority);

    // Pack contexts into the prompt, respecting token budget
    let totalTokens = 0;
    const includedContexts: string[] = [];

    for (const ctx of contexts) {
      if (totalTokens + ctx.tokenEstimate > this.maxTokenBudget) {
        // Try to summarize this context to fit
        const summarized = await this.summarize(ctx);
        if (totalTokens + summarized.tokenEstimate <= this.maxTokenBudget) {
          includedContexts.push(summarized.formatted);
          totalTokens += summarized.tokenEstimate;
        }
        // Skip if even summary doesn't fit
        continue;
      }
      includedContexts.push(ctx.formatter(ctx.data));
      totalTokens += ctx.tokenEstimate;
    }

    return includedContexts.join('\n\n---\n\n');
  }
}

// Context requirements by task type
const TASK_CONTEXT_MAP: Record<AITaskType, ContextCategory[]> = {
  'recipe_import': [
    'product_database_summary',      // Summarized list of 657+ products
    'sub_recipe_names',              // List of 245 sub recipe names
    'unit_standards',                // Standard units used in the system
    'category_list',                 // Valid recipe categories
  ],
  'cost_optimization': [
    'recipe_full',                   // Complete recipe with costs
    'product_alternatives',          // Alternative products for each ingredient
    'sub_recipe_costs',              // Sub recipe cost breakdowns
    'historical_costs',              // Price trends for ingredients
    'organization_targets',          // Food cost % targets
  ],
  'allergen_check': [
    'recipe_full',                   // Complete recipe
    'product_allergens',             // Allergen data for all products
    'sub_recipe_allergens',          // Allergens in sub recipes (recursive)
  ],
  'production_planning': [
    'recipes_summary',               // All recipes involved
    'equipment_list',                // Available equipment
    'staff_availability',            // Who's working
    'current_inventory',             // What's in stock
  ],
};
```

#### 4.2.2 Product Database Summarization

The full product database (657+ products) cannot be sent in every prompt. The context builder creates task-appropriate summaries:

```typescript
class ProductDatabaseSummarizer {
  // For recipe import: just names and categories
  summarizeForImport(products: Product[]): string {
    // Group by category for efficient lookup
    const byCategory = groupBy(products, 'category');
    let summary = 'AVAILABLE PRODUCTS (by category):\n';
    for (const [category, prods] of Object.entries(byCategory)) {
      summary += `\n${category}:\n`;
      summary += prods.map(p => `  - ${p.name} (${p.defaultUnit})`).join('\n');
    }
    return summary;
    // ~3000 tokens for 657 products
  }

  // For cost optimization: names, costs, and alternatives
  summarizeForCostOptimization(
    recipeIngredients: Ingredient[],
    allProducts: Product[]
  ): string {
    // Only include products relevant to the recipe + alternatives
    const relevantProducts = this.findRelevantProducts(recipeIngredients, allProducts);
    let summary = 'PRODUCT COSTS AND ALTERNATIVES:\n';
    for (const ing of recipeIngredients) {
      const alternatives = relevantProducts
        .filter(p => p.category === ing.product.category)
        .map(p => `${p.name}: AED ${p.costPerUnit}/${p.defaultUnit}`)
        .join(', ');
      summary += `\n${ing.product.name}: AED ${ing.product.costPerUnit}/${ing.product.defaultUnit}`;
      summary += `\n  Alternatives: ${alternatives}`;
    }
    return summary;
    // ~500-1500 tokens depending on recipe size
  }
}
```

### 4.3 Token Optimization

#### 4.3.1 Strategies for Reducing Token Usage

| Strategy | Description | Savings |
|---|---|---|
| Context summarization | Summarize product database, historical data before sending | 60-80% |
| Selective context | Only include data relevant to the specific task | 40-70% |
| Compact formatting | Use CSV-style data instead of verbose JSON in prompts | 30-50% |
| Response schemas | Use JSON mode with strict schemas to reduce output tokens | 20-40% |
| Multi-turn reduction | Combine related questions into a single prompt | 50% per avoided turn |
| Caching | Cache identical or near-identical requests | 100% for cache hits |
| Prompt template compilation | Pre-compute static portions of system prompts | 10-20% |

#### 4.3.2 Data Formatting for Token Efficiency

```typescript
// Verbose format (~45 tokens per product):
// {"name": "BUTTER UNSALTED 500G", "category": "DAIRY", "unit": "g", "cost_per_unit": 0.024, "supplier": "Dairy Farm Co"}

// Compact format (~20 tokens per product):
// BUTTER UNSALTED 500G | DAIRY | g | 0.024 | Dairy Farm Co

// For 657 products: ~29,500 tokens vs ~13,100 tokens (55% reduction)

class CompactDataFormatter {
  formatProducts(products: Product[]): string {
    const header = 'NAME | CATEGORY | UNIT | COST/UNIT | SUPPLIER';
    const rows = products.map(p => 
      `${p.name} | ${p.category} | ${p.defaultUnit} | ${p.costPerUnit} | ${p.supplierName}`
    );
    return [header, ...rows].join('\n');
  }

  formatRecipe(recipe: Recipe): string {
    let output = `RECIPE: ${recipe.name}\n`;
    output += `Category: ${recipe.category} | Yield: ${recipe.yield} ${recipe.yieldUnit}\n`;
    output += `Portions: ${recipe.portions}\n\n`;
    output += `INGREDIENTS:\n`;
    for (const ing of recipe.ingredients) {
      output += `  ${ing.quantity} ${ing.unit} ${ing.productName}`;
      if (ing.preparation) output += ` (${ing.preparation})`;
      output += ` -- AED ${ing.cost}\n`;
    }
    output += `\nMETHOD:\n`;
    recipe.methodSteps.forEach((step, i) => {
      output += `  ${i + 1}. ${step}\n`;
    });
    return output;
  }
}
```

### 4.4 Response Parsing and Validation

Every AI response is parsed and validated before being used by the application. This prevents malformed responses from corrupting data.

#### 4.4.1 Response Validation Pipeline

```typescript
class AIResponseValidator {
  async validate<T>(
    response: AIChatResponse,
    schema: JSONSchema,
    taskType: AITaskType
  ): Promise<ValidationResult<T>> {
    // Step 1: Extract JSON from response (handle markdown code blocks)
    const jsonStr = this.extractJSON(response.content);
    if (!jsonStr) {
      return { valid: false, error: 'No JSON found in response', retryable: true };
    }

    // Step 2: Parse JSON
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      // Try to fix common JSON issues (trailing commas, single quotes)
      const fixed = this.attemptJSONRepair(jsonStr);
      if (fixed) {
        parsed = JSON.parse(fixed);
      } else {
        return { valid: false, error: `Invalid JSON: ${e.message}`, retryable: true };
      }
    }

    // Step 3: Validate against schema
    const schemaResult = this.validateSchema(parsed, schema);
    if (!schemaResult.valid) {
      return { valid: false, error: `Schema violation: ${schemaResult.errors}`, retryable: true };
    }

    // Step 4: Business logic validation
    const businessResult = await this.validateBusinessRules(parsed, taskType);
    if (!businessResult.valid) {
      return { valid: false, error: businessResult.error, retryable: businessResult.retryable };
    }

    return { valid: true, data: parsed as T };
  }

  private async validateBusinessRules(data: any, taskType: AITaskType): Promise<BusinessValidation> {
    switch (taskType) {
      case 'recipe_import':
        return this.validateRecipeImport(data);
      case 'cost_optimization':
        return this.validateCostOptimization(data);
      case 'allergen_check':
        return this.validateAllergenCheck(data);
      default:
        return { valid: true };
    }
  }

  private validateRecipeImport(data: any): BusinessValidation {
    // Recipe must have at least one ingredient
    if (!data.ingredients || data.ingredients.length === 0) {
      return { valid: false, error: 'Recipe has no ingredients', retryable: true };
    }
    // Quantities must be positive
    for (const ing of data.ingredients) {
      if (ing.quantity !== null && ing.quantity <= 0) {
        return { valid: false, error: `Invalid quantity for ${ing.product_name}`, retryable: true };
      }
    }
    // Method must have at least one step
    if (!data.method || data.method.length === 0) {
      return { valid: false, error: 'Recipe has no method steps', retryable: true };
    }
    return { valid: true };
  }
}
```

#### 4.4.2 Retry on Validation Failure

When a response fails validation and is marked as retryable, the system sends a correction prompt:

```typescript
class AIRetryHandler {
  async retryWithCorrection<T>(
    originalRequest: AIChatRequest,
    failedResponse: AIChatResponse,
    validationError: string,
    schema: JSONSchema,
    maxRetries: number = 2
  ): Promise<T> {
    const correctionMessage: ChatMessage = {
      role: 'user',
      content: `Your previous response had a validation error: ${validationError}\n\nPlease fix the issue and return valid JSON matching the required schema.\n\nSchema: ${JSON.stringify(schema, null, 2)}`,
    };

    const retryRequest = {
      ...originalRequest,
      messages: [
        ...originalRequest.messages,
        { role: 'assistant', content: failedResponse.content },
        correctionMessage,
      ],
    };

    const retryResponse = await aiRouter.route(retryRequest);
    const validation = await this.validator.validate<T>(retryResponse, schema, originalRequest.metadata.taskType);
    
    if (validation.valid) return validation.data;
    
    if (maxRetries > 1) {
      return this.retryWithCorrection(originalRequest, retryResponse, validation.error, schema, maxRetries - 1);
    }
    
    throw new AIResponseValidationError(validation.error);
  }
}
```

### 4.5 Streaming Responses

For user-facing AI interactions (Q&A, recipe creation, explanations), responses are streamed to provide real-time feedback.

```typescript
class AIStreamHandler {
  async *streamResponse(
    request: AIChatRequest
  ): AsyncGenerator<StreamUpdate> {
    const provider = aiRouter.selectProvider(request);
    
    yield { type: 'started', provider: provider.displayName };

    let fullContent = '';
    let lastYieldedLength = 0;

    for await (const chunk of provider.chatStream(request)) {
      fullContent += chunk.delta;

      // Yield content in sentence-sized chunks for smooth rendering
      if (this.hasCompleteSentence(fullContent, lastYieldedLength)) {
        yield {
          type: 'content',
          delta: fullContent.substring(lastYieldedLength),
          totalLength: fullContent.length,
        };
        lastYieldedLength = fullContent.length;
      }
    }

    // Yield any remaining content
    if (fullContent.length > lastYieldedLength) {
      yield {
        type: 'content',
        delta: fullContent.substring(lastYieldedLength),
        totalLength: fullContent.length,
      };
    }

    // Validate the complete response
    yield { type: 'validating' };
    const validation = await this.validator.validate(
      { content: fullContent } as AIChatResponse,
      request.metadata.expectedSchema,
      request.metadata.taskType
    );

    if (validation.valid) {
      yield { type: 'completed', data: validation.data };
    } else {
      yield { type: 'validation_error', error: validation.error };
    }
  }
}
```

### 4.6 Error Handling

#### 4.6.1 Error Taxonomy

```typescript
enum AIErrorType {
  // Provider errors
  PROVIDER_UNAVAILABLE = 'provider_unavailable',
  RATE_LIMITED = 'rate_limited',
  AUTHENTICATION_FAILED = 'authentication_failed',
  CONTENT_FILTERED = 'content_filtered',
  CONTEXT_TOO_LARGE = 'context_too_large',
  
  // Response errors
  MALFORMED_RESPONSE = 'malformed_response',
  SCHEMA_VIOLATION = 'schema_violation',
  BUSINESS_RULE_VIOLATION = 'business_rule_violation',
  HALLUCINATION_DETECTED = 'hallucination_detected',
  
  // Budget errors
  BUDGET_EXCEEDED = 'budget_exceeded',
  QUOTA_EXHAUSTED = 'quota_exhausted',
  
  // System errors
  OFFLINE = 'offline',
  TIMEOUT = 'timeout',
  INTERNAL_ERROR = 'internal_error',
}

class AIError extends Error {
  constructor(
    public type: AIErrorType,
    public message: string,
    public retryable: boolean,
    public userMessage: string,       // Safe to show to the user
    public details?: Record<string, any>
  ) {
    super(message);
  }
}
```

#### 4.6.2 User-Facing Error Messages

Every AI error maps to a helpful, non-technical message:

| Error Type | User Message |
|---|---|
| PROVIDER_UNAVAILABLE | "The AI service is temporarily unavailable. Your request has been queued and will process automatically when the service recovers." |
| RATE_LIMITED | "You've made several AI requests recently. Please wait a moment before trying again." |
| BUDGET_EXCEEDED | "Your organization's AI usage limit has been reached for this month. Contact your administrator to increase the limit." |
| MALFORMED_RESPONSE | "The AI produced an unexpected response. Retrying with a different approach..." |
| HALLUCINATION_DETECTED | "The AI's response contained information that could not be verified against your data. Please review carefully." |
| OFFLINE | "You're currently offline. This request has been queued and will process when you reconnect." |
| TIMEOUT | "This request is taking longer than expected. It has been moved to background processing -- you'll be notified when complete." |

---

## 5. AI Data Pipeline

### 5.1 Embedding Generation

Embeddings are dense vector representations of text that enable semantic search, similarity detection, and clustering. CulinaryCore generates and maintains embeddings for all key entities.

#### 5.1.1 Embedding Strategy

| Entity | Embedding Content | Dimensions | Model | Refresh Trigger |
|---|---|---|---|---|
| Product | Name + category + description + allergens | 1536 | text-embedding-3-small | Product created/updated |
| Recipe | Title + ingredients list + method summary + category | 1536 | text-embedding-3-small | Recipe created/updated |
| Sub recipe | Name + ingredients list + use cases | 1536 | text-embedding-3-small | Sub recipe created/updated |
| Supplier | Name + product categories + location | 1536 | text-embedding-3-small | Supplier created/updated |
| Document | Full text content (chunked at ~500 tokens) | 1536 | text-embedding-3-small | Document uploaded |

#### 5.1.2 Embedding Storage

Embeddings are stored in PostgreSQL using the pgvector extension (available in Supabase):

```sql
-- Product embeddings table
CREATE TABLE product_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  embedding VECTOR(1536) NOT NULL,
  content_hash TEXT NOT NULL,        -- Hash of the text that was embedded
  created_at TIMESTAMPTZ DEFAULT NOW(),
  model_version TEXT NOT NULL        -- Track which model generated this
);

-- Create HNSW index for fast approximate nearest neighbor search
CREATE INDEX ON product_embeddings 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Recipe embeddings table
CREATE TABLE recipe_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,
  embedding VECTOR(1536) NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  model_version TEXT NOT NULL
);

CREATE INDEX ON recipe_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
```

#### 5.1.3 Embedding Generation Pipeline

```typescript
class EmbeddingPipeline {
  private batchSize = 100;           // Process embeddings in batches
  private queue: EmbeddingJob[] = [];

  // Called when an entity is created or updated
  async onEntityChange(entityType: string, entityId: string): Promise<void> {
    const content = await this.getEmbeddingContent(entityType, entityId);
    const contentHash = hash(content);

    // Check if embedding already exists for this content
    const existing = await this.getExistingEmbedding(entityType, entityId);
    if (existing && existing.contentHash === contentHash) {
      return; // Content hasn't changed, skip re-embedding
    }

    this.queue.push({ entityType, entityId, content, contentHash });

    if (this.queue.length >= this.batchSize) {
      await this.processBatch();
    }
  }

  private async processBatch(): Promise<void> {
    const batch = this.queue.splice(0, this.batchSize);
    const texts = batch.map(job => job.content);

    // Generate embeddings in batch (more efficient than one at a time)
    const embeddings = await aiRouter.embed({
      texts,
      metadata: { taskType: 'embedding_generation' },
    });

    // Store embeddings
    for (let i = 0; i < batch.length; i++) {
      await this.storeEmbedding(
        batch[i].entityType,
        batch[i].entityId,
        embeddings[i],
        batch[i].contentHash
      );
    }
  }

  private async getEmbeddingContent(entityType: string, entityId: string): Promise<string> {
    switch (entityType) {
      case 'product': {
        const product = await db.products.get(entityId);
        return `${product.name} | ${product.category} | ${product.description || ''} | Allergens: ${product.allergens.join(', ')}`;
      }
      case 'recipe': {
        const recipe = await db.recipes.get(entityId, { include: ['ingredients', 'method'] });
        const ingredients = recipe.ingredients.map(i => i.productName).join(', ');
        const methodSummary = recipe.methodSteps.slice(0, 3).join('. ');
        return `${recipe.name} | ${recipe.category} | Ingredients: ${ingredients} | Method: ${methodSummary}`;
      }
      // ... other entity types
    }
  }
}
```

### 5.2 Vector Search

#### 5.2.1 Similar Recipe Search

```typescript
class RecipeSearch {
  async findSimilar(recipeId: string, limit: number = 5): Promise<SimilarRecipe[]> {
    const recipeEmbedding = await this.getEmbedding('recipe', recipeId);

    const results = await db.query(`
      SELECT r.*, re.embedding <=> $1 AS distance
      FROM recipe_embeddings re
      JOIN recipes r ON r.id = re.recipe_id
      WHERE re.recipe_id != $2
      ORDER BY re.embedding <=> $1
      LIMIT $3
    `, [recipeEmbedding, recipeId, limit]);

    return results.map(r => ({
      recipe: r,
      similarity: 1 - r.distance,    // Convert distance to similarity
    }));
  }

  // Semantic search: find recipes by description
  async search(query: string, filters?: RecipeFilters): Promise<SearchResult[]> {
    const queryEmbedding = await aiRouter.embed({ text: query });

    let sql = `
      SELECT r.*, re.embedding <=> $1 AS distance
      FROM recipe_embeddings re
      JOIN recipes r ON r.id = re.recipe_id
      WHERE re.embedding <=> $1 < 0.5   -- Similarity threshold
    `;
    const params: any[] = [queryEmbedding];

    if (filters?.category) {
      sql += ` AND r.category = $${params.length + 1}`;
      params.push(filters.category);
    }
    if (filters?.maxFoodCostPercent) {
      sql += ` AND r.food_cost_percent <= $${params.length + 1}`;
      params.push(filters.maxFoodCostPercent);
    }

    sql += ` ORDER BY re.embedding <=> $1 LIMIT 20`;

    return db.query(sql, params);
  }
}
```

#### 5.2.2 Product Search and Discovery

Semantic product search enables finding products even when the user's terminology doesn't match the database:

- "cream" finds CREAM HEAVY, CREAM LIGHT, SOUR CREAM, CREAM CHEESE
- "chicken" finds CHICKEN BREAST, CHICKEN THIGH, CHICKEN STOCK, CHICKEN WINGS
- "greens" finds SPINACH, KALE, ARUGULA, MIXED SALAD LEAVES, SPRING ONION

### 5.3 Knowledge Graph

The AI system builds and maintains a knowledge graph of relationships between entities.

#### 5.3.1 Relationship Types

```typescript
type EntityRelationship =
  | { type: 'contains'; from: 'recipe'; to: 'product'; quantity: number; unit: string }
  | { type: 'contains_sub_recipe'; from: 'recipe'; to: 'sub_recipe' }
  | { type: 'substitutes_for'; from: 'product'; to: 'product'; context: string }
  | { type: 'supplied_by'; from: 'product'; to: 'supplier' }
  | { type: 'pairs_with'; from: 'product'; to: 'product'; confidence: number }
  | { type: 'same_category'; from: 'product'; to: 'product' }
  | { type: 'allergen_conflict'; from: 'product'; to: 'allergen' }
  | { type: 'seasonal_availability'; from: 'product'; to: 'season'; region: string }
  | { type: 'cuisine_association'; from: 'recipe'; to: 'cuisine' }
  | { type: 'technique_uses'; from: 'recipe'; to: 'technique' }
  ;
```

#### 5.3.2 Knowledge Graph Uses

| Use Case | Graph Query |
|---|---|
| Ingredient substitution | Find products with `substitutes_for` relationship |
| Allergen propagation | Traverse `contains` and `contains_sub_recipe` edges to find all allergens |
| Impact analysis | "If product X price changes, which recipes are affected?" -- traverse `contains` edges |
| Menu diversity | Check that a menu covers diverse `cuisine_association` and `technique_uses` edges |
| Supplier risk | If a supplier fails, find all products via `supplied_by` and all recipes via `contains` |

### 5.4 Training Data Collection

User corrections to AI outputs are the most valuable source of system improvement. Every correction is recorded and used to improve future performance.

#### 5.4.1 Correction Types

```typescript
interface AICorrection {
  id: string;
  taskType: AITaskType;
  originalInput: string;              // What the AI received
  originalOutput: string;             // What the AI produced
  correctedOutput: string;            // What the user changed it to
  correctionType: 'ingredient_match' | 'quantity' | 'unit' | 'structure' | 'allergen' | 'cost' | 'other';
  timestamp: Date;
  userId: string;
  organizationId: string;
}
```

#### 5.4.2 Improvement Mechanisms

| Mechanism | Description | Implementation |
|---|---|---|
| Product matching improvement | User corrections update product name aliases | Store "user called it X, matched to product Y" for fuzzy matching boost |
| Prompt refinement | Repeated correction patterns inform prompt updates | Aggregate corrections by type, update system prompts monthly |
| Few-shot examples | Best corrections become few-shot examples in prompts | Select high-quality corrections as prompt examples |
| Confidence calibration | Track predicted confidence vs actual accuracy | Adjust confidence thresholds based on historical accuracy |
| Custom terminology | Organization-specific ingredient names | Build per-organization synonym dictionaries |

### 5.5 A/B Testing of Prompts and Models

#### 5.5.1 A/B Test Framework

```typescript
interface ABTest {
  id: string;
  name: string;
  taskType: AITaskType;
  variants: ABVariant[];
  trafficSplit: number[];            // [50, 50] for equal split
  metrics: string[];                  // What to measure
  startDate: Date;
  endDate: Date;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
}

interface ABVariant {
  id: string;
  name: string;                       // "control" or "variant_a"
  systemPrompt?: string;             // Different prompt
  model?: string;                     // Different model
  temperature?: number;               // Different temperature
}

interface ABTestResult {
  testId: string;
  variantResults: {
    variantId: string;
    sampleSize: number;
    metrics: {
      accuracy: number;               // % of responses accepted without correction
      userSatisfaction: number;        // Thumbs up/down ratio
      latencyP50: number;
      latencyP95: number;
      avgCostUSD: number;
      correctionRate: number;          // % of responses that were corrected
    };
  }[];
  winner: string;                     // Variant ID
  confidence: number;                 // Statistical significance
}
```

#### 5.5.2 Metrics Tracked

| Metric | Description | Target |
|---|---|---|
| Acceptance rate | % of AI outputs accepted without modification | > 85% |
| Correction rate | % of AI outputs that needed user correction | < 15% |
| Task completion time | Time from request to final accepted result | Decreasing trend |
| Cost per task | Average AI cost per task type | Within budget |
| User satisfaction | Explicit thumbs up/down feedback | > 4.0/5.0 |
| Hallucination rate | % of responses containing ungrounded information | < 1% |
| Allergen accuracy | % of allergen checks with no missed allergens | 100% |

---

## 6. Safety and Guardrails

### 6.1 Allergen Safety

Allergen safety is the single most critical safety domain in CulinaryCore. A missed allergen can result in hospitalization or death. The system applies defense-in-depth.

#### 6.1.1 Allergen Safety Principles

1. **Never suppress allergen warnings.** The AI can add allergen warnings but can never remove them. Only a human user can remove an allergen designation, and the action is logged with a reason.

2. **Fail safe.** If there is any doubt about whether an ingredient contains an allergen, report it as a possible allergen. False positives (unnecessary warnings) are acceptable; false negatives (missed allergens) are not.

3. **Recursive checking.** Allergen checks traverse all sub recipe layers. A recipe that uses a sub recipe that uses a product containing an allergen must report that allergen.

4. **Cross-contamination awareness.** The system flags cross-contamination risks based on shared equipment, preparation areas, and supplier statements ("may contain traces of").

5. **Immutable allergen audit trail.** Every allergen-related change is recorded in an append-only audit log. This log cannot be deleted or modified.

#### 6.1.2 Implementation

```typescript
class AllergenSafetyGuard {
  // Called before any recipe modification is saved
  async validateRecipeChange(
    original: Recipe,
    modified: Recipe
  ): Promise<AllergenSafetyResult> {
    const originalAllergens = await this.getAllAllergens(original);
    const modifiedAllergens = await this.getAllAllergens(modified);

    // Check if any allergens were removed
    const removedAllergens = originalAllergens.filter(
      a => !modifiedAllergens.includes(a)
    );

    if (removedAllergens.length > 0) {
      return {
        safe: false,
        requiresHumanConfirmation: true,
        message: `This change would remove allergen warnings for: ${removedAllergens.join(', ')}. This requires explicit confirmation and a documented reason.`,
        removedAllergens,
      };
    }

    // Check if new allergens were introduced
    const addedAllergens = modifiedAllergens.filter(
      a => !originalAllergens.includes(a)
    );

    if (addedAllergens.length > 0) {
      return {
        safe: true,
        warnings: [`New allergens detected: ${addedAllergens.join(', ')}. These will be added to the recipe's allergen profile.`],
        addedAllergens,
      };
    }

    return { safe: true };
  }

  // Allergen audit log
  async logAllergenChange(change: AllergenAuditEntry): Promise<void> {
    await db.allergenAudit.insert({
      ...change,
      timestamp: new Date(),
      // This table has no UPDATE or DELETE permissions
      // enforced at the database level via RLS policies
    });
  }
}
```

### 6.2 Cost Accuracy

#### 6.2.1 AI Cost vs Calculated Cost Validation

When the AI generates or modifies cost data, the system independently verifies the calculations:

```typescript
class CostAccuracyGuard {
  async validateAICosts(
    aiGeneratedCosts: RecipeCosts,
    recipe: Recipe
  ): Promise<CostValidationResult> {
    // Independently calculate costs using the deterministic cost engine
    const calculatedCosts = await costEngine.calculate(recipe);

    // Compare AI costs with calculated costs
    const discrepancy = Math.abs(
      aiGeneratedCosts.totalCost - calculatedCosts.totalCost
    ) / calculatedCosts.totalCost;

    if (discrepancy > 0.05) {  // More than 5% discrepancy
      return {
        valid: false,
        message: `AI-generated cost (AED ${aiGeneratedCosts.totalCost.toFixed(2)}) differs from calculated cost (AED ${calculatedCosts.totalCost.toFixed(2)}) by ${(discrepancy * 100).toFixed(1)}%. Using calculated cost.`,
        useCost: calculatedCosts,       // Always prefer deterministic calculation
        flagForReview: discrepancy > 0.15,  // Review if > 15% off
      };
    }

    return { valid: true, useCost: calculatedCosts };
  }
}
```

**Key rule**: The AI never sets final cost values. The AI may suggest ingredient changes, and the deterministic cost engine recalculates all costs based on the actual product database. The AI's role is reasoning about costs, not calculating them.

### 6.3 Hallucination Prevention

#### 6.3.1 Grounding Strategy

All AI responses must be grounded in actual data from the CulinaryCore database. The system enforces this through several mechanisms:

```typescript
class HallucinationGuard {
  async validate(
    response: AIChatResponse,
    providedContext: ContextData
  ): Promise<HallucinationCheckResult> {
    const checks: HallucinationCheck[] = [];

    // Check 1: Product name validation
    const mentionedProducts = this.extractProductReferences(response.content);
    for (const productName of mentionedProducts) {
      const exists = providedContext.products.some(
        p => p.name.toLowerCase() === productName.toLowerCase()
      );
      if (!exists) {
        checks.push({
          type: 'unknown_product',
          severity: 'high',
          detail: `AI referenced product "${productName}" which does not exist in the database.`,
        });
      }
    }

    // Check 2: Price validation
    const mentionedPrices = this.extractPriceReferences(response.content);
    for (const { productName, price } of mentionedPrices) {
      const product = providedContext.products.find(
        p => p.name.toLowerCase() === productName.toLowerCase()
      );
      if (product && Math.abs(product.costPerUnit - price) / product.costPerUnit > 0.1) {
        checks.push({
          type: 'incorrect_price',
          severity: 'high',
          detail: `AI stated "${productName}" costs AED ${price} but database shows AED ${product.costPerUnit}.`,
        });
      }
    }

    // Check 3: Recipe existence validation
    const mentionedRecipes = this.extractRecipeReferences(response.content);
    for (const recipeName of mentionedRecipes) {
      const exists = providedContext.recipes.some(
        r => r.name.toLowerCase() === recipeName.toLowerCase()
      );
      if (!exists) {
        checks.push({
          type: 'unknown_recipe',
          severity: 'medium',
          detail: `AI referenced recipe "${recipeName}" which does not exist in the database.`,
        });
      }
    }

    // Check 4: Supplier existence validation
    const mentionedSuppliers = this.extractSupplierReferences(response.content);
    for (const supplierName of mentionedSuppliers) {
      const exists = providedContext.suppliers.some(
        s => s.name.toLowerCase() === supplierName.toLowerCase()
      );
      if (!exists) {
        checks.push({
          type: 'unknown_supplier',
          severity: 'medium',
          detail: `AI referenced supplier "${supplierName}" which does not exist in the database.`,
        });
      }
    }

    const hasHighSeverity = checks.some(c => c.severity === 'high');
    return {
      passed: !hasHighSeverity,
      checks,
      requiresDisclaimer: checks.length > 0,
    };
  }
}
```

#### 6.3.2 Disclaimer Injection

When the hallucination guard detects any issues, the response is annotated:

```typescript
class ResponseAnnotator {
  annotate(
    response: string,
    hallucinationChecks: HallucinationCheck[]
  ): AnnotatedResponse {
    if (hallucinationChecks.length === 0) {
      return { content: response, annotations: [], disclaimer: null };
    }

    return {
      content: response,
      annotations: hallucinationChecks.map(c => ({
        type: c.type,
        message: c.detail,
        severity: c.severity,
      })),
      disclaimer: 'Some information in this response could not be verified against your database. Items marked with a warning icon should be independently confirmed.',
    };
  }
}
```

### 6.4 Human-in-the-Loop

Certain actions triggered or suggested by the AI require explicit human confirmation before execution.

#### 6.4.1 Actions Requiring Human Confirmation

| Action | Reason | Confirmation UI |
|---|---|---|
| Modifying allergen data | Safety-critical | Modal with reason field, requires typed confirmation ("I confirm") |
| Changing product costs | Financial impact | Side-by-side comparison with approve/reject |
| Deleting recipes or products | Irreversible | Confirmation with undo period (30 seconds) |
| Batch operations (> 5 items) | Blast radius | Summary of all changes with approve/reject per item |
| Publishing to menu | Customer-facing | Preview with final approval |
| Creating new products from AI suggestion | Data quality | Pre-filled form requiring field-by-field review |
| Accepting recipe import | Data quality | Full review UI with original document comparison |
| Applying cost optimization suggestions | Financial impact | Impact summary with per-suggestion accept/reject |

#### 6.4.2 Confirmation Flow

```typescript
class HumanConfirmationFlow {
  async requestConfirmation(
    action: PendingAction,
    context: ConfirmationContext
  ): Promise<ConfirmationResult> {
    // Create a pending confirmation record
    const confirmation = await db.pendingConfirmations.insert({
      actionType: action.type,
      actionData: action.data,
      requestedBy: 'ai_system',
      context: context.summary,
      createdAt: new Date(),
      expiresAt: action.expiresAt,
      status: 'pending',
    });

    // Notify the user via the appropriate channel
    await notificationService.send({
      userId: context.userId,
      type: 'confirmation_required',
      title: `AI action requires your approval`,
      body: context.summary,
      actionUrl: `/confirmations/${confirmation.id}`,
      priority: action.priority,
    });

    // The action is NOT executed until the user approves
    return { confirmationId: confirmation.id, status: 'pending' };
  }
}
```

### 6.5 Audit Trail

Every AI-assisted change is recorded in an immutable audit trail.

```typescript
interface AIAuditTrail {
  id: string;
  timestamp: Date;
  userId: string;
  organizationId: string;
  actionType: string;
  entityType: string;                 // 'recipe', 'product', 'sub_recipe'
  entityId: string;
  aiTaskType: AITaskType;
  aiProvider: string;
  aiModel: string;
  aiTraceId: string;
  changeDescription: string;          // Human-readable description
  previousState: any;                 // Snapshot before change (encrypted)
  newState: any;                      // Snapshot after change (encrypted)
  humanApproved: boolean;
  humanApprovalTimestamp?: Date;
  humanApprovalUserId?: string;
  humanApprovalReason?: string;       // Required for allergen changes
}
```

The audit trail table is append-only. Row-level security (RLS) policies in Supabase prevent UPDATE and DELETE operations. Only INSERT is allowed for application roles. Administrative access for compliance review is restricted to organization administrators through a separate, read-only interface.

---

## 7. Future AI Capabilities

The following capabilities are planned for future releases. Each builds on the foundation established in Sections 1-6.

### 7.1 Computer Vision for Inventory Counting

**Concept**: Use the device camera (iPad or iPhone) to count inventory items by photographing shelves, walk-in coolers, and storage areas.

**Technical approach:**
- Object detection model trained on common food packaging (bottles, cans, bags, boxes).
- Barcode/QR code detection for product identification.
- Quantity estimation (count visible items, estimate depth of stacks).
- Integration with the product database to match detected items.

**Implementation phases:**
1. **Phase 1 -- Barcode scanning**: Scan product barcodes to identify items and log counts manually.
2. **Phase 2 -- Assisted counting**: Camera identifies products and suggests counts; user confirms.
3. **Phase 3 -- Automated counting**: Camera counts items automatically with high accuracy; user only reviews discrepancies.

**Data requirements:**
- Product images for training (photos of each product as received).
- Barcode-to-product mapping table.
- Shelf/location metadata (expected products per location).

### 7.2 Voice-Controlled Recipe Navigation

**Concept**: Hands-free recipe navigation in the kitchen using voice commands.

**Capabilities:**
- "Read me step 3" -- AI reads the method step aloud.
- "Next step" / "Previous step" -- Navigate through the recipe.
- "How much butter do I need?" -- Query ingredient quantities.
- "Set a timer for 12 minutes" -- Integrated timers.
- "What temperature should the oven be?" -- Extract temperature information.
- "Convert 200 grams to ounces" -- On-the-fly unit conversion.
- "Add a note: I used brown sugar instead of white" -- Voice annotations.

**Technical approach:**
- Apple Speech framework for on-device speech recognition (privacy-preserving).
- Natural Language understanding (on-device for simple commands, cloud for complex queries).
- Text-to-speech for reading recipe steps.
- Noise filtering optimized for kitchen environments (exhaust fans, clattering, running water).

### 7.3 Predictive Ordering

**Concept**: Predict what products need to be ordered based on upcoming production plans, historical usage patterns, current inventory levels, and supplier lead times.

**Prediction model inputs:**
- Historical order data (what was ordered, when, how much).
- Production schedules (planned recipes and quantities).
- Inventory levels (current stock).
- Supplier lead times (how long from order to delivery).
- Seasonal patterns (higher demand in certain periods).
- Events calendar (large bookings, holidays, promotions).
- Waste data (predicted waste reduces effective yield).

**Output:**
- Recommended order quantities per product, per supplier.
- Optimal order timing (when to place each order).
- Safety stock recommendations.
- Alerts for predicted stockouts.

### 7.4 Waste Pattern Analysis

**Concept**: Analyze waste data to identify patterns, root causes, and reduction opportunities.

**Analysis dimensions:**
- Waste by product (which products are wasted most, by volume and cost).
- Waste by recipe (which recipes generate the most waste).
- Waste by time (day of week, meal service, season).
- Waste by station (which kitchen station generates the most waste).
- Waste by cause (overproduction, spoilage, preparation waste, plate waste).

**AI insights:**
- "Your SALMON FILLET waste peaks on Mondays. Consider reducing Monday prep by 20% based on historical demand."
- "MIXED SALAD LEAVES have a 30% waste rate, significantly above the 10% industry average. Consider switching to whole lettuce heads for longer shelf life."
- "Overproduction accounts for 45% of your waste. AI-optimized production planning could reduce this by an estimated 60%."

### 7.5 Menu Engineering AI

**Concept**: Comprehensive menu analysis combining profitability, popularity, and strategic placement.

**Analysis framework (Boston Matrix for menus):**

| Category | Popularity | Profitability | Strategy |
|---|---|---|---|
| Stars | High | High | Maintain, feature prominently |
| Plowhorses | High | Low | Re-engineer to improve margins |
| Puzzles | Low | High | Promote, improve visibility |
| Dogs | Low | Low | Remove or completely reimagine |

**AI-driven recommendations:**
- Optimal menu item placement (eye-tracking based positioning).
- Price elasticity analysis (how much can prices increase before demand drops).
- Menu item cannibalization detection (similar items competing for the same customer).
- Seasonal menu rotation recommendations.
- New item suggestions based on menu gaps (missing cuisine styles, price points, dietary options).

### 7.6 Customer Preference Learning

**Concept**: Learn from order patterns and feedback to personalize recommendations.

**Data sources:**
- POS integration (what was ordered, by whom, when).
- Table feedback (satisfaction surveys, complaint logs).
- Dietary preference tracking (returning customers' requirements).
- Seasonal preference shifts.

**Applications:**
- Personalized menu recommendations for repeat customers.
- Predict popular items for upcoming events based on guest profiles.
- Identify trending ingredients or cuisines.
- Inform recipe development based on customer preferences.

### 7.7 Dynamic Pricing Suggestions

**Concept**: Suggest menu price adjustments based on real-time factors.

**Factors considered:**
- Current food costs (recent price changes).
- Demand patterns (day of week, time of day, season).
- Competitor pricing (if market data is integrated).
- Inventory levels (promote items with excess stock).
- Weather impact on demand.
- Special events and holidays.

**Constraints:**
- Never change prices without human approval.
- Respect minimum margin requirements.
- Maintain price consistency within a service period.
- Flag any suggestion that could be perceived as discriminatory or unfair.

**Implementation:**
- Dashboard showing current prices, suggested prices, and the reasoning.
- Batch approval workflow for periodic price reviews.
- A/B testing support for price experiments.
- Revenue impact projections for proposed changes.

---

## Appendix A: AI Task Type Registry

A complete enumeration of all AI task types in the system, their default tier, and configuration.

| Task Type ID | Description | Default Tier | Max Tokens (In) | Max Tokens (Out) | Cacheable | Requires Confirmation |
|---|---|---|---|---|---|---|
| `autocomplete` | Ingredient name completion | On-Device | 500 | 50 | Yes | No |
| `unit_detection` | Parse quantity and unit from text | On-Device | 200 | 50 | Yes | No |
| `simple_classification` | Categorize recipe | On-Device | 500 | 20 | Yes | No |
| `spell_correction` | Fix typos in ingredient names | On-Device | 200 | 200 | Yes | No |
| `ingredient_parsing` | Parse ingredient line to structured data | Small | 1000 | 500 | Yes | No |
| `unit_conversion` | Convert between measurement systems | Small | 500 | 200 | Yes | No |
| `text_formatting` | Standardize recipe wording | Small | 2000 | 2000 | No | No |
| `allergen_detection` | Scan for allergen keywords | Small | 2000 | 500 | Yes | No |
| `translation` | Translate recipe text | Small | 3000 | 3000 | Yes | No |
| `recipe_import` | Parse document into structured recipe | Large | 8000 | 4000 | No | Yes |
| `recipe_creation` | Generate recipe from description | Large | 6000 | 4000 | No | Yes |
| `cost_optimization` | Suggest cost reductions | Large | 6000 | 3000 | No | No |
| `ingredient_substitution` | Recommend alternatives | Large | 4000 | 2000 | No | No |
| `recipe_scaling` | Scale recipe with adjustments | Large | 4000 | 3000 | No | No |
| `consistency_check` | Validate recipe consistency | Large | 4000 | 2000 | No | No |
| `nutrition_analysis` | Analyze nutritional profile | Large | 4000 | 2000 | Yes (4h) | No |
| `production_planning` | Generate production schedule | Large | 8000 | 4000 | No | Yes |
| `qa` | Natural language Q&A | Large | 4000 | 2000 | Yes (4h) | No |
| `cost_explanation` | Explain cost changes | Large | 4000 | 2000 | Yes (1h) | No |
| `cost_forecasting` | Predict future costs | Large | 6000 | 3000 | No | No |
| `menu_engineering` | Holistic menu analysis | Frontier | 16000 | 8000 | No | No |
| `haccp_generation` | Generate HACCP documentation | Frontier | 8000 | 8000 | No | Yes |
| `complex_import` | Parse complex/handwritten recipes | Frontier | 16000 | 8000 | No | Yes |
| `multi_constraint_optimization` | Optimize across multiple constraints | Frontier | 12000 | 6000 | No | Yes |
| `embedding_generation` | Generate text embeddings | Small | 500 | N/A | Yes (30d) | No |
| `product_matching` | Match ingredient to product database | Small | 2000 | 500 | Yes | No |

## Appendix B: JSON Schemas for AI Responses

### B.1 Recipe Import Response Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["recipes"],
  "properties": {
    "recipes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["title", "ingredients", "method"],
        "properties": {
          "title": { "type": "string" },
          "category": { "type": "string", "enum": ["BITES", "SALADS", "COLD", "HOT", "MAINS", "GRILL", "SIDES", "BREAD", "PIZZA", "DESSERT", "KIDS MENU", "HAPPY HOUR"] },
          "cuisine": { "type": "string" },
          "yield": { "type": "number" },
          "yield_unit": { "type": "string" },
          "portions": { "type": "integer" },
          "prep_time_minutes": { "type": "integer" },
          "cook_time_minutes": { "type": "integer" },
          "total_time_minutes": { "type": "integer" },
          "temperatures": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "value": { "type": "number" },
                "unit": { "type": "string", "enum": ["C", "F"] },
                "context": { "type": "string" }
              }
            }
          },
          "ingredients": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["product_name"],
              "properties": {
                "quantity": { "type": ["number", "null"] },
                "unit": { "type": ["string", "null"] },
                "product_name": { "type": "string" },
                "preparation": { "type": ["string", "null"] },
                "is_optional": { "type": "boolean", "default": false },
                "is_sub_recipe": { "type": "boolean", "default": false },
                "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
              }
            }
          },
          "method": {
            "type": "array",
            "items": { "type": "string" }
          },
          "notes": {
            "type": "array",
            "items": { "type": "string" }
          },
          "equipment": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },
    "parsing_confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "ambiguities": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "description": { "type": "string" },
          "location": { "type": "string" },
          "options": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

### B.2 Cost Optimization Response Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["suggestions", "summary"],
  "properties": {
    "suggestions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "description", "cost_impact", "quality_impact"],
        "properties": {
          "type": { "type": "string", "enum": ["substitute", "ratio_adjust", "batch", "seasonal", "portion", "grade"] },
          "description": { "type": "string" },
          "current_ingredient": { "type": "string" },
          "suggested_ingredient": { "type": ["string", "null"] },
          "suggested_quantity": { "type": ["number", "null"] },
          "suggested_unit": { "type": ["string", "null"] },
          "cost_impact": {
            "type": "object",
            "properties": {
              "current_cost_aed": { "type": "number" },
              "new_cost_aed": { "type": "number" },
              "savings_aed": { "type": "number" },
              "savings_percent": { "type": "number" }
            }
          },
          "quality_impact": { "type": "string", "enum": ["none", "minimal", "noticeable", "significant"] },
          "quality_notes": { "type": "string" },
          "allergen_changes": {
            "type": "object",
            "properties": {
              "added": { "type": "array", "items": { "type": "string" } },
              "removed": { "type": "array", "items": { "type": "string" } }
            }
          },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "summary": {
      "type": "object",
      "properties": {
        "total_potential_savings_aed": { "type": "number" },
        "total_potential_savings_percent": { "type": "number" },
        "current_food_cost_percent": { "type": "number" },
        "projected_food_cost_percent": { "type": "number" }
      }
    }
  }
}
```

## Appendix C: Privacy Decision Matrix

This matrix guides which AI provider to use based on the data sensitivity of the request.

| Data Contains | On-Device OK? | Cloud (Zero-Retention API) OK? | Cloud (Standard API) OK? | Notes |
|---|---|---|---|---|
| Generic cooking knowledge only | Yes | Yes | Yes | No business data involved |
| Recipe names and ingredients | Yes | Yes | Org admin consent | Business data |
| Product costs and prices | Yes | Yes | Org admin consent | Business data |
| Supplier names and contracts | Yes | Enterprise agreement only | No | Sensitive business data |
| Customer information | Yes | No | No | Handle on-device only |
| Employee/user personal data | No (strip first) | No | No | Restricted -- strip from all AI requests |
| Payment/financial details | No | No | No | Never sent to any AI |

---

## 8. Competitive Readiness AI Controls — Finance, Safety & Workforce

### 8.1 Approved AI use cases

AI may classify invoices, extract delivery/lot/expiry information, propose match exceptions, forecast demand/prep/labour, detect temperature or waste anomalies, and summarise recall impact. Each output is a draft with source provenance, confidence, model/prompt version and a human review boundary.

### 8.2 Prohibited autonomous actions

AI must not autonomously: post invoices or accounting journals; issue/refund/route payments; schedule staff in violation of policy; make employment, disciplinary, pay or leave decisions; release blocked food; close a HACCP corrective action; or claim a product is allergen-safe/compliant without verified source data and required human approval.

### 8.3 Evaluation and monitoring requirements

Maintain a labelled evaluation set for invoice/receipt extraction, ingredient matching, allergen detection, lot/expiry extraction and demand forecast error. Measure field-level accuracy, confidence calibration, demographic/location bias where workforce data is involved, false-negative safety risk, override rate, latency and cost. A model/prompt change must pass regression thresholds and preserve an auditable rollback path.

### 8.4 Data minimisation

Employee identifiers, payroll data, payment details and customer personal data must be excluded from prompts unless a documented, approved, provider-specific privacy decision says otherwise. Use opaque IDs and minimal task context. AI-generated finance/safety records are never the authoritative record until the domain workflow approves them.

---

## 9. AI Boundaries for Procurement and People Workspaces

AI may extract, classify, summarise, forecast, identify missing evidence and propose next steps. It must not be the decision-maker for hiring, rejection, performance rating, discipline, promotion, compensation, payroll, payment release, supplier award, supplier bank amendment, safety release or compliance closure.

For People workflows, prompts must exclude restricted HR data unless a narrowly scoped, documented privacy decision permits an approved provider and purpose. Any AI ranking or recommendation affecting people must be explainable, reviewable, monitored for bias and never applied automatically. For Procurement, AI may draft a supplier comparison or match explanation but a policy-authorised human must approve awards, exceptions and payments.

All outputs must include source record IDs, confidence, model/prompt version, human reviewer, final decision and override reason. Analytics may use aggregated labour data by default; individual employee data requires an explicit restricted-data permission.

---

*End of Document 5: AI System Design*
*CulinaryCore -- Commercial Recipe and Hospitality Management Platform*
