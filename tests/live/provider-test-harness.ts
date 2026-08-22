import { inspect } from "node:util";

import { encodePcm16Wav } from "../../packages/audio/src/pcm-wav.js";
import { providerReadinessErrorMessage } from "../../packages/shared/src/provider-readiness.js";
import type { ProviderReadinessErrorCategory } from "../../packages/shared/src/schemas.js";

export const LIVE_TEST_OPT_IN = "VOXMESH_LIVE_TESTS";
export const LIVE_TEST_PROVIDERS = "VOXMESH_LIVE_PROVIDERS";
export const LIVE_TEST_CAPABILITIES = "VOXMESH_LIVE_CAPABILITIES";

export const liveProviderIds = [
  "azure-openai",
  "openai-compatible",
  "alibaba-model-studio"
] as const;

export const liveCapabilityIds = [
  "chat",
  "stt",
  "tts",
  "composed-voice"
] as const;

export type LiveProviderId = (typeof liveProviderIds)[number];
export type LiveCapabilityId = (typeof liveCapabilityIds)[number];

export interface LiveChatConfiguration {
  endpoint: URL;
  apiKey: SecretValue;
  model: string;
  apiVersion?: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface LiveSpeechToTextConfiguration {
  endpoint: URL;
  apiKey: SecretValue;
  model: string;
  apiVersion?: string;
  language?: string;
  fixturePath?: string;
  timeoutMs: number;
}

export interface LiveTextToSpeechConfiguration {
  endpoint: URL;
  apiKey: SecretValue;
  model: string;
  apiVersion?: string;
  voice: string;
  instructions?: string;
  responseFormat: string;
  timeoutMs: number;
}

export interface LiveProviderConfiguration {
  chat?: LiveChatConfiguration;
  stt?: LiveSpeechToTextConfiguration;
  tts?: LiveTextToSpeechConfiguration;
}

export interface LiveTestPlan {
  enabled: boolean;
  providers: readonly LiveProviderId[];
  capabilities: readonly LiveCapabilityId[];
  maximumRequests: number;
  azureOpenAi?: LiveProviderConfiguration;
  openAiCompatible?: LiveProviderConfiguration;
  alibabaModelStudio?: LiveProviderConfiguration;
}

export type LiveTestErrorCategory = ProviderReadinessErrorCategory;

export interface SanitizedLiveTestError {
  category: LiveTestErrorCategory;
  message: string;
}

export interface LiveProviderRequestOptions {
  label: string;
  timeoutMs: number;
  budget: LiveRequestBudget;
  secrets?: readonly SecretValue[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAXIMUM_REQUESTS = 12;
const MAXIMUM_REQUEST_LIMIT = 50;
const REDACTED = "[REDACTED]";

const supportedCapabilities: Readonly<
  Record<LiveProviderId, ReadonlySet<LiveCapabilityId>>
> = {
  "azure-openai": new Set(liveCapabilityIds),
  "openai-compatible": new Set(liveCapabilityIds),
  "alibaba-model-studio": new Set(["stt", "tts", "composed-voice"])
};

/**
 * Wraps a credential so JSON serialization, string conversion, and Node
 * inspection cannot reveal it accidentally. Call `reveal` only within the
 * request-authorization boundary or the redaction boundary that removes the
 * same credential from diagnostic text.
 */
export class SecretValue {
  readonly #value: string;

  public constructor(value: string) {
    if (value.trim().length === 0) {
      throw new Error("Live provider secrets must not be empty");
    }
    this.#value = value;
  }

  public reveal(): string {
    return this.#value;
  }

  public toJSON(): string {
    return REDACTED;
  }

  public toString(): string {
    return REDACTED;
  }

  public [inspect.custom](): string {
    return REDACTED;
  }
}

/** Loads live-test configuration only after explicit operator opt-in. */
export function loadLiveTestPlan(
  environment: NodeJS.ProcessEnv = process.env
): LiveTestPlan {
  const enabled = parseOptIn(environment[LIVE_TEST_OPT_IN]);
  if (!enabled) {
    return {
      enabled: false,
      providers: [],
      capabilities: [],
      maximumRequests: 0
    };
  }

  const providers = parseSelector(
    environment[LIVE_TEST_PROVIDERS],
    LIVE_TEST_PROVIDERS,
    liveProviderIds
  );
  if (providers.length !== 1) {
    throw new LiveTestConfigurationError(
      `${LIVE_TEST_PROVIDERS} must select exactly one provider family per live run`
    );
  }
  const capabilities = parseSelector(
    environment[LIVE_TEST_CAPABILITIES],
    LIVE_TEST_CAPABILITIES,
    liveCapabilityIds
  );
  assertSupportedSelection(providers, capabilities);

  const maximumRequests = parseInteger(
    environment.VOXMESH_LIVE_MAX_REQUESTS,
    "VOXMESH_LIVE_MAX_REQUESTS",
    DEFAULT_MAXIMUM_REQUESTS,
    1,
    MAXIMUM_REQUEST_LIMIT
  );

  const azureOpenAi = providers.includes("azure-openai")
    ? loadAzureConfiguration(environment, capabilities)
    : undefined;
  const openAiCompatible = providers.includes("openai-compatible")
    ? loadOpenAiCompatibleConfiguration(environment, capabilities)
    : undefined;
  const alibabaModelStudio = providers.includes("alibaba-model-studio")
    ? loadAlibabaConfiguration(environment, capabilities)
    : undefined;

  return {
    enabled: true,
    providers,
    capabilities,
    maximumRequests,
    ...(azureOpenAi ? { azureOpenAi } : {}),
    ...(openAiCompatible ? { openAiCompatible } : {}),
    ...(alibabaModelStudio ? { alibabaModelStudio } : {})
  };
}

/** Returns whether a provider/capability scenario was explicitly selected. */
export function shouldRunLiveScenario(
  plan: LiveTestPlan,
  provider: LiveProviderId,
  capability: LiveCapabilityId
): boolean {
  return (
    plan.enabled &&
    plan.providers.includes(provider) &&
    plan.capabilities.includes(capability) &&
    supportedCapabilities[provider].has(capability)
  );
}

/**
 * Enforces a hard request count so a faulty live suite cannot create an
 * unbounded number of billable provider calls.
 */
export class LiveRequestBudget {
  readonly #maximum: number;
  #used = 0;

  public constructor(maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error("Live request budget must be a positive integer");
    }
    this.#maximum = maximum;
  }

  public get remaining(): number {
    return this.#maximum - this.#used;
  }

  public consume(label: string): void {
    if (this.#used >= this.#maximum) {
      throw new Error(
        `Live request budget of ${this.#maximum} was exhausted before ${label}`
      );
    }
    this.#used += 1;
  }
}

/**
 * Runs one potentially billable operation through the mandatory request
 * budget, timeout, cancellation, and error-sanitization boundaries.
 */
export async function executeLiveProviderRequest<T>(
  options: LiveProviderRequestOptions,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  options.budget.consume(options.label);
  try {
    return await runWithLiveTestTimeout(
      options.label,
      options.timeoutMs,
      operation
    );
  } catch (error) {
    const sanitized = sanitizeLiveTestError(error, options.secrets);
    throw new LiveTestRequestError(sanitized.category, sanitized.message);
  }
}

/** Runs one provider operation with cancellation and a bounded timeout. */
export async function runWithLiveTestTimeout<T>(
  label: string,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Live test timeout must be a positive integer");
  }

  const controller = new AbortController();
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(
        new LiveTestTimeoutError(`${label} timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);

    // Both handlers stay attached after a timeout so a late provider result,
    // including rejection after cancellation, can never become unhandled.
    void Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(
            error instanceof Error
              ? error
              : new Error("Live provider operation rejected without an Error")
          );
        }
      );
  });
}

/** Creates deterministic, non-speech PCM16 WAV data without personal content. */
export function createSyntheticPcm16Wav(
  durationMs = 250,
  frequencyHz = 440,
  sampleRate = 16_000
): Uint8Array {
  if (!Number.isInteger(durationMs) || durationMs < 20 || durationMs > 5_000) {
    throw new Error(
      "Synthetic audio duration must be an integer between 20 and 5000ms"
    );
  }
  if (
    !Number.isFinite(frequencyHz) ||
    frequencyHz < 20 ||
    frequencyHz > sampleRate / 2
  ) {
    throw new Error("Synthetic audio frequency must be within the PCM band");
  }
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 48_000
  ) {
    throw new Error(
      "Synthetic audio sample rate must be an integer between 8000 and 48000Hz"
    );
  }

  const sampleCount = Math.floor((durationMs / 1_000) * sampleRate);
  const pcm = new Uint8Array(sampleCount * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * 8_192
    );
    view.setInt16(index * 2, sample, true);
  }

  return encodePcm16Wav({ channels: 1, sampleRate, pcm });
}

/** Redacts configured secrets and common authorization syntax from text. */
export function redactSensitiveText(
  text: string,
  secrets: readonly SecretValue[]
): string {
  let sanitized = text;
  for (const secret of secrets) {
    sanitized = sanitized.split(secret.reveal()).join(REDACTED);
  }
  return sanitized
    .replace(
      /\b(authorization|api-key|x-api-key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/giu,
      `$1=${REDACTED}`
    )
    .replace(
      /([?&](?:api[-_]?key|token|access[-_]?token)=)[^&#\s]+/giu,
      `$1${REDACTED}`
    );
}

/** Maps an unknown provider failure into bounded, credential-safe output. */
export function sanitizeLiveTestError(
  error: unknown,
  secrets: readonly SecretValue[] = []
): SanitizedLiveTestError {
  const message = redactSensitiveText(errorMessage(error), secrets);
  let category: LiveTestErrorCategory;
  if (
    error instanceof LiveTestTimeoutError ||
    /\btimeout|timed out\b/iu.test(message)
  ) {
    category = "timeout";
  } else if (
    (error instanceof DOMException && error.name === "AbortError") ||
    /\bcancelled|canceled|aborted\b/iu.test(message)
  ) {
    category = "cancelled";
  } else if (/\b429\b|\bquota\b|\brate limit\b|\bthrottl/iu.test(message)) {
    category = "quota";
  } else if (
    /\b401\b|\b403\b|\bauthentication\b|\bunauthorized\b|\bforbidden\b|\bapi[-_ ]?key\b|\bcredential/iu.test(
      message
    )
  ) {
    category = "authentication";
  } else if (
    /\bmalformed\b|\binvalid (?:response|json)\b|\bempty (?:response|audio|text)\b/iu.test(
      message
    )
  ) {
    category = "invalid-response";
  } else if (error instanceof LiveTestConfigurationError) {
    category = "configuration";
  } else {
    category = "provider";
  }
  return { category, message: providerReadinessErrorMessage(category) };
}

export class LiveTestConfigurationError extends Error {
  public override readonly name = "LiveTestConfigurationError";
}

export class LiveTestTimeoutError extends Error {
  public override readonly name = "LiveTestTimeoutError";
}

export class LiveTestRequestError extends Error {
  public override readonly name = "LiveTestRequestError";

  public constructor(
    public readonly category: LiveTestErrorCategory,
    message: string
  ) {
    super(message);
  }
}

function loadAzureConfiguration(
  environment: NodeJS.ProcessEnv,
  capabilities: readonly LiveCapabilityId[]
): LiveProviderConfiguration {
  const composed = capabilities.includes("composed-voice");
  return {
    ...(capabilities.includes("chat") || composed
      ? {
          chat: loadChatConfiguration(environment, {
            prefix: "VOXMESH_LIVE_AZURE_CHAT",
            apiVersion: true
          })
        }
      : {}),
    ...(capabilities.includes("stt") || composed
      ? {
          stt: loadSttConfiguration(environment, {
            prefix: "VOXMESH_LIVE_AZURE_STT",
            apiVersion: true
          })
        }
      : {}),
    ...(capabilities.includes("tts") || composed
      ? {
          tts: loadTtsConfiguration(environment, {
            prefix: "VOXMESH_LIVE_AZURE_TTS",
            apiVersion: true
          })
        }
      : {})
  };
}

function loadOpenAiCompatibleConfiguration(
  environment: NodeJS.ProcessEnv,
  capabilities: readonly LiveCapabilityId[]
): LiveProviderConfiguration {
  const composed = capabilities.includes("composed-voice");
  return {
    ...(capabilities.includes("chat") || composed
      ? {
          chat: loadChatConfiguration(environment, {
            prefix: "VOXMESH_LIVE_OPENAI_CHAT"
          })
        }
      : {}),
    ...(capabilities.includes("stt") || composed
      ? {
          stt: loadSttConfiguration(environment, {
            prefix: "VOXMESH_LIVE_OPENAI_STT"
          })
        }
      : {}),
    ...(capabilities.includes("tts") || composed
      ? {
          tts: loadTtsConfiguration(environment, {
            prefix: "VOXMESH_LIVE_OPENAI_TTS"
          })
        }
      : {})
  };
}

function loadAlibabaConfiguration(
  environment: NodeJS.ProcessEnv,
  capabilities: readonly LiveCapabilityId[]
): LiveProviderConfiguration {
  const composed = capabilities.includes("composed-voice");
  return {
    ...(composed
      ? {
          chat: loadChatConfiguration(environment, {
            prefix: "VOXMESH_LIVE_OPENAI_CHAT"
          })
        }
      : {}),
    ...(capabilities.includes("stt") || composed
      ? {
          stt: loadSttConfiguration(environment, {
            prefix: "VOXMESH_LIVE_ALIBABA_STT",
            websocket: true
          })
        }
      : {}),
    ...(capabilities.includes("tts") || composed
      ? {
          tts: loadTtsConfiguration(environment, {
            prefix: "VOXMESH_LIVE_ALIBABA_TTS",
            websocket: true
          })
        }
      : {})
  };
}

function loadChatConfiguration(
  environment: NodeJS.ProcessEnv,
  options: { prefix: string; apiVersion?: boolean }
): LiveChatConfiguration {
  return {
    endpoint: readUrl(environment, `${options.prefix}_ENDPOINT`, "https:"),
    apiKey: readSecret(environment, `${options.prefix}_API_KEY`),
    model: readRequired(environment, `${options.prefix}_MODEL`),
    ...(options.apiVersion
      ? {
          apiVersion: readRequired(environment, `${options.prefix}_API_VERSION`)
        }
      : {}),
    timeoutMs: parseInteger(
      environment[`${options.prefix}_TIMEOUT_MS`],
      `${options.prefix}_TIMEOUT_MS`,
      DEFAULT_TIMEOUT_MS,
      1,
      MAX_TIMEOUT_MS
    ),
    maxOutputTokens: parseInteger(
      environment[`${options.prefix}_MAX_OUTPUT_TOKENS`],
      `${options.prefix}_MAX_OUTPUT_TOKENS`,
      128,
      1,
      4_096
    )
  };
}

function loadSttConfiguration(
  environment: NodeJS.ProcessEnv,
  options: { prefix: string; apiVersion?: boolean; websocket?: boolean }
): LiveSpeechToTextConfiguration {
  return {
    endpoint: readUrl(
      environment,
      `${options.prefix}_ENDPOINT`,
      options.websocket ? "wss:" : "https:"
    ),
    apiKey: readSecret(environment, `${options.prefix}_API_KEY`),
    model: readRequired(environment, `${options.prefix}_MODEL`),
    ...(options.apiVersion
      ? {
          apiVersion: readRequired(environment, `${options.prefix}_API_VERSION`)
        }
      : {}),
    ...optionalValue(environment, `${options.prefix}_LANGUAGE`, "language"),
    ...optionalValue(
      environment,
      `${options.prefix}_FIXTURE_PATH`,
      "fixturePath"
    ),
    timeoutMs: parseInteger(
      environment[`${options.prefix}_TIMEOUT_MS`],
      `${options.prefix}_TIMEOUT_MS`,
      DEFAULT_TIMEOUT_MS,
      1,
      MAX_TIMEOUT_MS
    )
  };
}

function loadTtsConfiguration(
  environment: NodeJS.ProcessEnv,
  options: { prefix: string; apiVersion?: boolean; websocket?: boolean }
): LiveTextToSpeechConfiguration {
  return {
    endpoint: readUrl(
      environment,
      `${options.prefix}_ENDPOINT`,
      options.websocket ? "wss:" : "https:"
    ),
    apiKey: readSecret(environment, `${options.prefix}_API_KEY`),
    model: readRequired(environment, `${options.prefix}_MODEL`),
    ...(options.apiVersion
      ? {
          apiVersion: readRequired(environment, `${options.prefix}_API_VERSION`)
        }
      : {}),
    voice: readRequired(environment, `${options.prefix}_VOICE`),
    ...optionalValue(
      environment,
      `${options.prefix}_INSTRUCTIONS`,
      "instructions"
    ),
    responseFormat:
      environment[`${options.prefix}_RESPONSE_FORMAT`]?.trim() || "wav",
    timeoutMs: parseInteger(
      environment[`${options.prefix}_TIMEOUT_MS`],
      `${options.prefix}_TIMEOUT_MS`,
      DEFAULT_TIMEOUT_MS,
      1,
      MAX_TIMEOUT_MS
    )
  };
}

function parseOptIn(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "" || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new LiveTestConfigurationError(
    `${LIVE_TEST_OPT_IN} must be exactly "true" or "false"`
  );
}

function parseSelector<T extends string>(
  value: string | undefined,
  name: string,
  allowed: readonly T[]
): T[] {
  const selected = [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  ];
  if (selected.length === 0) {
    throw new LiveTestConfigurationError(
      `${name} must select at least one value after live tests are enabled`
    );
  }
  const invalid = selected.filter((item) => !allowed.includes(item as T));
  if (invalid.length > 0) {
    throw new LiveTestConfigurationError(
      `${name} contains unsupported values: ${invalid.join(", ")}`
    );
  }
  return selected as T[];
}

function assertSupportedSelection(
  providers: readonly LiveProviderId[],
  capabilities: readonly LiveCapabilityId[]
): void {
  if (
    !providers.some((provider) =>
      capabilities.some((capability) =>
        supportedCapabilities[provider].has(capability)
      )
    )
  ) {
    throw new LiveTestConfigurationError(
      "The selected providers and capabilities do not contain a supported live scenario"
    );
  }
}

function readRequired(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new LiveTestConfigurationError(
      `${name} is required for the selected live scenarios`
    );
  }
  return value;
}

function readSecret(environment: NodeJS.ProcessEnv, name: string): SecretValue {
  return new SecretValue(readRequired(environment, name));
}

function readUrl(
  environment: NodeJS.ProcessEnv,
  name: string,
  protocol: "https:" | "wss:"
): URL {
  const raw = readRequired(environment, name);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new LiveTestConfigurationError(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== protocol) {
    throw new LiveTestConfigurationError(`${name} must use ${protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new LiveTestConfigurationError(
      `${name} must not contain embedded credentials`
    );
  }
  if (
    [...parsed.searchParams.keys()].some((key) =>
      /^(?:api[-_]?key|token|access[-_]?token)$/iu.test(key)
    )
  ) {
    throw new LiveTestConfigurationError(
      `${name} must not contain credentials in query parameters`
    );
  }
  return parsed;
}

function optionalValue<T extends string>(
  environment: NodeJS.ProcessEnv,
  name: string,
  property: T
): { [key in T]?: string } {
  const value = environment[name]?.trim();
  return value ? ({ [property]: value } as { [key in T]?: string }) : {};
}

function parseInteger(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new LiveTestConfigurationError(
      `${name} must be an integer between ${minimum} and ${maximum}`
    );
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Live provider request failed without an error message";
}
