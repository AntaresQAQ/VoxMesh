import { inspect } from "node:util";

import { decodePcm16Wav } from "../../packages/audio/src/pcm-wav.js";
import { describe, expect, it, vi } from "vitest";

import {
  createSyntheticPcm16Wav,
  executeLiveProviderRequest,
  LiveRequestBudget,
  LiveTestConfigurationError,
  LiveTestRequestError,
  LiveTestTimeoutError,
  loadLiveTestPlan,
  redactSensitiveText,
  runWithLiveTestTimeout,
  sanitizeLiveTestError,
  SecretValue,
  shouldRunLiveScenario
} from "./provider-test-harness.js";

describe("live provider test harness", () => {
  it("stays disabled without reading provider configuration", () => {
    expect(
      loadLiveTestPlan({
        VOXMESH_LIVE_AZURE_CHAT_ENDPOINT: "not a URL",
        VOXMESH_LIVE_AZURE_CHAT_API_KEY: "should-not-be-read"
      })
    ).toEqual({
      enabled: false,
      providers: [],
      capabilities: [],
      maximumRequests: 0
    });
  });

  it("requires exact opt-in and explicit valid selectors", () => {
    expect(() => loadLiveTestPlan({ VOXMESH_LIVE_TESTS: "yes" })).toThrow(
      'VOXMESH_LIVE_TESTS must be exactly "true" or "false"'
    );
    expect(() => loadLiveTestPlan({ VOXMESH_LIVE_TESTS: "true" })).toThrow(
      "VOXMESH_LIVE_PROVIDERS must select at least one value"
    );
    expect(() =>
      loadLiveTestPlan({
        VOXMESH_LIVE_TESTS: "true",
        VOXMESH_LIVE_PROVIDERS: "unknown",
        VOXMESH_LIVE_CAPABILITIES: "chat"
      })
    ).toThrow("VOXMESH_LIVE_PROVIDERS contains unsupported values: unknown");
    expect(() =>
      loadLiveTestPlan({
        VOXMESH_LIVE_TESTS: "true",
        VOXMESH_LIVE_PROVIDERS: "alibaba-model-studio",
        VOXMESH_LIVE_CAPABILITIES: "chat"
      })
    ).toThrow(
      "alibaba-model-studio does not support selected capabilities: chat"
    );
    expect(() =>
      loadLiveTestPlan({
        VOXMESH_LIVE_TESTS: "true",
        VOXMESH_LIVE_PROVIDERS: "alibaba-model-studio",
        VOXMESH_LIVE_CAPABILITIES: "chat,stt"
      })
    ).toThrow(
      "alibaba-model-studio does not support selected capabilities: chat"
    );
    expect(() =>
      loadLiveTestPlan({
        VOXMESH_LIVE_TESTS: "true",
        VOXMESH_LIVE_PROVIDERS: "azure-openai,openai-compatible",
        VOXMESH_LIVE_CAPABILITIES: "chat"
      })
    ).toThrow(
      "VOXMESH_LIVE_PROVIDERS must select exactly one provider family per live run"
    );
  });

  it("loads only selected Azure configuration with bounded defaults", () => {
    const plan = loadLiveTestPlan({
      VOXMESH_LIVE_TESTS: "true",
      VOXMESH_LIVE_PROVIDERS: "azure-openai",
      VOXMESH_LIVE_CAPABILITIES: "chat",
      VOXMESH_LIVE_MAX_REQUESTS: "3",
      VOXMESH_LIVE_AZURE_CHAT_ENDPOINT: "https://example.test",
      VOXMESH_LIVE_AZURE_CHAT_API_KEY: "azure-secret",
      VOXMESH_LIVE_AZURE_CHAT_MODEL: "chat-deployment",
      VOXMESH_LIVE_AZURE_CHAT_API_VERSION: "2024-10-21"
    });

    expect(plan.enabled).toBe(true);
    expect(plan.maximumRequests).toBe(3);
    expect(plan.azureOpenAi?.chat).toMatchObject({
      endpoint: new URL("https://example.test"),
      model: "chat-deployment",
      apiVersion: "2024-10-21",
      timeoutMs: 30_000,
      maxOutputTokens: 128
    });
    expect(plan.azureOpenAi?.chat?.apiKey.reveal()).toBe("azure-secret");
    expect(plan.azureOpenAi?.stt).toBeUndefined();
    expect(plan.openAiCompatible).toBeUndefined();
    expect(shouldRunLiveScenario(plan, "azure-openai", "chat")).toBe(true);
    expect(shouldRunLiveScenario(plan, "azure-openai", "stt")).toBe(false);
  });

  it("loads Alibaba composed voice roles without inferring shared values", () => {
    const plan = loadLiveTestPlan({
      VOXMESH_LIVE_TESTS: "true",
      VOXMESH_LIVE_PROVIDERS: "alibaba-model-studio",
      VOXMESH_LIVE_CAPABILITIES: "composed-voice",
      VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT: "https://chat.example.test/v1",
      VOXMESH_LIVE_OPENAI_CHAT_API_KEY: "chat-secret",
      VOXMESH_LIVE_OPENAI_CHAT_MODEL: "qwen-test",
      VOXMESH_LIVE_ALIBABA_STT_ENDPOINT:
        "wss://stt.example.test/api-ws/v1/inference",
      VOXMESH_LIVE_ALIBABA_STT_API_KEY: "stt-secret",
      VOXMESH_LIVE_ALIBABA_STT_MODEL: "asr-test",
      VOXMESH_LIVE_ALIBABA_TTS_ENDPOINT:
        "wss://tts.example.test/api-ws/v1/inference",
      VOXMESH_LIVE_ALIBABA_TTS_API_KEY: "tts-secret",
      VOXMESH_LIVE_ALIBABA_TTS_MODEL: "tts-test",
      VOXMESH_LIVE_ALIBABA_TTS_VOICE: "voice-test"
    });

    expect(plan.alibabaModelStudio?.chat?.apiKey.reveal()).toBe("chat-secret");
    expect(plan.alibabaModelStudio?.stt?.apiKey.reveal()).toBe("stt-secret");
    expect(plan.alibabaModelStudio?.tts?.apiKey.reveal()).toBe("tts-secret");
    expect(shouldRunLiveScenario(plan, "alibaba-model-studio", "chat")).toBe(
      false
    );
    expect(
      shouldRunLiveScenario(plan, "alibaba-model-studio", "composed-voice")
    ).toBe(true);
  });

  it("rejects unsafe URLs and invalid request bounds before network access", () => {
    const base = {
      VOXMESH_LIVE_TESTS: "true",
      VOXMESH_LIVE_PROVIDERS: "openai-compatible",
      VOXMESH_LIVE_CAPABILITIES: "chat",
      VOXMESH_LIVE_OPENAI_CHAT_API_KEY: "secret",
      VOXMESH_LIVE_OPENAI_CHAT_MODEL: "model"
    };

    expect(() =>
      loadLiveTestPlan({
        ...base,
        VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT: "http://example.test"
      })
    ).toThrow("VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT must use https:");
    expect(() =>
      loadLiveTestPlan({
        ...base,
        VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT: "https://user:password@example.test"
      })
    ).toThrow(
      "VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT must not contain embedded credentials"
    );
    expect(() =>
      loadLiveTestPlan({
        ...base,
        VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT:
          "https://example.test/v1?api_key=secret"
      })
    ).toThrow(
      "VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT must not contain credentials in query parameters"
    );
    expect(() =>
      loadLiveTestPlan({
        ...base,
        VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT: "https://example.test",
        VOXMESH_LIVE_MAX_REQUESTS: "51"
      })
    ).toThrow("VOXMESH_LIVE_MAX_REQUESTS must be an integer between 1 and 50");
  });

  it("redacts secrets during serialization, inspection, and error mapping", () => {
    const secret = new SecretValue("credential-value");

    expect(String(secret)).toBe("[REDACTED]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(inspect(secret)).toBe("[REDACTED]");
    expect(
      redactSensitiveText(
        "authorization: Bearer credential-value?api_key=another-secret",
        [secret, new SecretValue("another-secret")]
      )
    ).not.toContain("credential-value");
    expect(
      sanitizeLiveTestError(
        new Error("HTTP 401 for api-key=credential-value"),
        [secret]
      )
    ).toEqual({
      category: "authentication",
      message: "Provider authentication failed."
    });
    expect(
      sanitizeLiveTestError(
        new LiveTestConfigurationError("Missing configuration")
      ).category
    ).toBe("configuration");
  });

  it("enforces the live request budget", () => {
    const budget = new LiveRequestBudget(2);

    budget.consume("first request");
    budget.consume("second request");
    expect(budget.remaining).toBe(0);
    expect(() => budget.consume("third request")).toThrow(
      "Live request budget of 2 was exhausted before third request"
    );
  });

  it("runs a deterministic provider double through all request boundaries", async () => {
    const budget = new LiveRequestBudget(1);
    const result = await executeLiveProviderRequest(
      {
        label: "deterministic Chat request",
        timeoutMs: 100,
        budget
      },
      async (signal) => {
        expect(signal.aborted).toBe(false);
        return { response: "deterministic response" };
      }
    );

    expect(result).toEqual({ response: "deterministic response" });
    expect(budget.remaining).toBe(0);
  });

  it("surfaces provider-double failures without retaining the raw error", async () => {
    const secret = new SecretValue("provider-secret");

    await expect(
      executeLiveProviderRequest(
        {
          label: "failing Chat request",
          timeoutMs: 100,
          budget: new LiveRequestBudget(1),
          secrets: [secret]
        },
        async () => {
          throw new Error("HTTP 429 api-key=provider-secret");
        }
      )
    ).rejects.toEqual(
      new LiveTestRequestError(
        "quota",
        "Provider quota or rate limit was exceeded."
      )
    );
  });

  it("aborts operations that exceed their timeout", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const result = runWithLiveTestTimeout("Chat request", 50, (signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise<string>(() => undefined);
    });
    const rejection = expect(result).rejects.toEqual(
      new LiveTestTimeoutError("Chat request timed out after 50ms")
    );

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(aborted).toBe(true);
    vi.useRealTimers();
  });

  it("observes a provider rejection that arrives after timeout", async () => {
    vi.useFakeTimers();
    let rejectProvider: ((error: Error) => void) | undefined;
    const result = runWithLiveTestTimeout(
      "late provider request",
      50,
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectProvider = reject;
        })
    );
    const rejection = expect(result).rejects.toEqual(
      new LiveTestTimeoutError("late provider request timed out after 50ms")
    );

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    rejectProvider?.(new Error("late provider rejection"));
    await Promise.resolve();
    vi.useRealTimers();
  });

  it("generates deterministic non-speech mono PCM16 WAV data", () => {
    const first = createSyntheticPcm16Wav(100, 440, 16_000);
    const second = createSyntheticPcm16Wav(100, 440, 16_000);
    const decoded = decodePcm16Wav(first);

    expect(first).toEqual(second);
    expect(decoded.channels).toBe(1);
    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.pcm.byteLength).toBe(3_200);
  });
});
