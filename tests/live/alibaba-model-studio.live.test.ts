import { beforeAll, describe, expect, test } from "vitest";

import {
  AlibabaModelStudioQualification,
  alibabaMinimumRequestCount
} from "./alibaba-model-studio-qualification.js";
import {
  LiveRequestBudget,
  LiveTestConfigurationError,
  loadLiveTestPlan,
  shouldRunLiveScenario
} from "./provider-test-harness.js";

const plan = loadLiveTestPlan();
const selected =
  plan.enabled && plan.providers.includes("alibaba-model-studio");
const budget = selected
  ? new LiveRequestBudget(plan.maximumRequests)
  : undefined;
const qualification =
  selected && plan.alibabaModelStudio && budget
    ? new AlibabaModelStudioQualification(plan.alibabaModelStudio, budget)
    : undefined;

describe.skipIf(!selected)("Alibaba Model Studio live qualification", () => {
  beforeAll(() => {
    const requiredRequests = alibabaMinimumRequestCount(plan.capabilities);
    if (plan.maximumRequests < requiredRequests) {
      throw new LiveTestConfigurationError(
        `Alibaba scenarios require at least ${requiredRequests} requests, but VOXMESH_LIVE_MAX_REQUESTS is ${plan.maximumRequests}`
      );
    }
  });

  test.runIf(shouldRunLiveScenario(plan, "alibaba-model-studio", "stt"))(
    "qualifies dedicated Fun-ASR STT",
    async () => {
      await expect(requiredQualification().transcribe()).resolves.toBeTruthy();
    }
  );

  test.runIf(shouldRunLiveScenario(plan, "alibaba-model-studio", "tts"))(
    "qualifies dedicated Qwen/CosyVoice TTS",
    async () => {
      const audio = await requiredQualification().synthesize();
      expect(audio.mimeType).toContain("wav");
      expect(audio.data).toBeInstanceOf(Uint8Array);
      expect(audio.data.byteLength).toBeGreaterThan(44);
    }
  );

  test.runIf(
    shouldRunLiveScenario(plan, "alibaba-model-studio", "composed-voice")
  )("qualifies buffered Alibaba composed voice", async () => {
    const result = await requiredQualification().composedVoice();
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.usedTools).toEqual(["mock.get_device_status"]);
    expect(result.audioMimeType).toContain("wav");
    expect(result.audioByteLength).toBeGreaterThan(44);
  });
});

function requiredQualification(): AlibabaModelStudioQualification {
  if (!qualification) {
    throw new LiveTestConfigurationError(
      "Alibaba qualification configuration was not loaded"
    );
  }
  return qualification;
}
