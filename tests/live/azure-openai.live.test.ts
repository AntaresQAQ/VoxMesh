import { beforeAll, describe, expect, test } from "vitest";

import {
  AzureOpenAiQualification,
  azureMinimumRequestCount
} from "./azure-openai-qualification.js";
import {
  LiveRequestBudget,
  LiveTestConfigurationError,
  loadLiveTestPlan,
  shouldRunLiveScenario
} from "./provider-test-harness.js";

const plan = loadLiveTestPlan();
const selected = plan.enabled && plan.providers.includes("azure-openai");
const budget = selected
  ? new LiveRequestBudget(plan.maximumRequests)
  : undefined;
const qualification =
  selected && plan.azureOpenAi && budget
    ? new AzureOpenAiQualification(plan.azureOpenAi, budget)
    : undefined;

describe.skipIf(!selected)("Azure OpenAI live qualification", () => {
  beforeAll(() => {
    const requiredRequests = azureMinimumRequestCount(plan.capabilities);
    if (plan.maximumRequests < requiredRequests) {
      throw new LiveTestConfigurationError(
        `Azure scenarios require at least ${requiredRequests} requests, but VOXMESH_LIVE_MAX_REQUESTS is ${plan.maximumRequests}`
      );
    }
  });

  test.runIf(shouldRunLiveScenario(plan, "azure-openai", "chat"))(
    "qualifies direct Chat",
    async () => {
      await expect(requiredQualification().chatDirect()).resolves.toBeTruthy();
    }
  );

  test.runIf(shouldRunLiveScenario(plan, "azure-openai", "chat"))(
    "qualifies MCP-assisted Chat",
    async () => {
      await expect(
        requiredQualification().chatWithTools()
      ).resolves.toBeTruthy();
    }
  );

  test.runIf(shouldRunLiveScenario(plan, "azure-openai", "stt"))(
    "qualifies buffered STT",
    async () => {
      await expect(requiredQualification().transcribe()).resolves.toBeTruthy();
    }
  );

  test.runIf(shouldRunLiveScenario(plan, "azure-openai", "tts"))(
    "qualifies buffered TTS",
    async () => {
      const audio = await requiredQualification().synthesize();
      expect(audio.mimeType).toContain("wav");
      expect(audio.data).toBeInstanceOf(Uint8Array);
      expect(audio.data.byteLength).toBeGreaterThan(44);
    }
  );

  test.runIf(shouldRunLiveScenario(plan, "azure-openai", "composed-voice"))(
    "qualifies buffered composed voice",
    async () => {
      const result = await requiredQualification().composedVoice();
      expect(result.transcript.length).toBeGreaterThan(0);
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.usedTools).toEqual(["mock.get_device_status"]);
      expect(result.audioMimeType).toContain("wav");
      expect(result.audioByteLength).toBeGreaterThan(44);
    }
  );
});

function requiredQualification(): AzureOpenAiQualification {
  if (!qualification) {
    throw new LiveTestConfigurationError(
      "Azure qualification configuration was not loaded"
    );
  }
  return qualification;
}
