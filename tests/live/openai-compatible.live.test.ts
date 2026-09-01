import { beforeAll, describe, expect, test } from "vitest";

import {
  compatibleMinimumRequestCount,
  OpenAiCompatibleQualification
} from "./openai-compatible-qualification.js";
import {
  LiveRequestBudget,
  LiveTestConfigurationError,
  loadLiveTestPlan,
  shouldRunLiveScenario
} from "./provider-test-harness.js";

const plan = loadLiveTestPlan();
const selected = plan.enabled && plan.providers.includes("openai-compatible");
const budget = selected
  ? new LiveRequestBudget(plan.maximumRequests)
  : undefined;
const qualification =
  selected && plan.openAiCompatible && budget
    ? new OpenAiCompatibleQualification(plan.openAiCompatible, budget)
    : undefined;

describe.skipIf(!selected)("OpenAI-compatible live qualification", () => {
  beforeAll(() => {
    const requiredRequests = compatibleMinimumRequestCount(plan.capabilities);
    if (plan.maximumRequests < requiredRequests) {
      throw new LiveTestConfigurationError(
        `OpenAI-compatible scenarios require at least ${requiredRequests} requests, but VOXMESH_LIVE_MAX_REQUESTS is ${plan.maximumRequests}`
      );
    }
  });

  test.runIf(shouldRunLiveScenario(plan, "openai-compatible", "chat"))(
    "qualifies direct Chat",
    async () => {
      await expect(requiredQualification().chatDirect()).resolves.toBeTruthy();
    }
  );

  test.runIf(
    shouldRunLiveScenario(plan, "openai-compatible", "streaming-chat")
  )("qualifies direct Streaming Chat", async () => {
    await expect(
      requiredQualification().streamingChatDirect()
    ).resolves.toBeTruthy();
  });

  test.runIf(
    shouldRunLiveScenario(plan, "openai-compatible", "streaming-chat")
  )("qualifies MCP-assisted Streaming Chat", async () => {
    await expect(
      requiredQualification().streamingChatWithTools()
    ).resolves.toBeTruthy();
  });

  test.runIf(shouldRunLiveScenario(plan, "openai-compatible", "chat"))(
    "qualifies MCP-assisted Chat",
    async () => {
      await expect(
        requiredQualification().chatWithTools()
      ).resolves.toBeTruthy();
    }
  );

  test.runIf(shouldRunLiveScenario(plan, "openai-compatible", "stt"))(
    "qualifies buffered STT",
    async () => {
      await expect(requiredQualification().transcribe()).resolves.toBeTruthy();
    }
  );

  test.runIf(shouldRunLiveScenario(plan, "openai-compatible", "tts"))(
    "qualifies buffered TTS",
    async () => {
      const audio = await requiredQualification().synthesize();
      expect(audio.mimeType).toContain("wav");
      expect(audio.data).toBeInstanceOf(Uint8Array);
      expect(audio.data.byteLength).toBeGreaterThan(44);
    }
  );

  test.runIf(
    shouldRunLiveScenario(plan, "openai-compatible", "composed-voice")
  )("qualifies buffered composed voice", async () => {
    const result = await requiredQualification().composedVoice();
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.usedTools).toEqual(["mock.get_device_status"]);
    expect(result.audioMimeType).toContain("wav");
    expect(result.audioByteLength).toBeGreaterThan(44);
  });
});

function requiredQualification(): OpenAiCompatibleQualification {
  if (!qualification) {
    throw new LiveTestConfigurationError(
      "OpenAI-compatible qualification configuration was not loaded"
    );
  }
  return qualification;
}
