import { describe, expect, it } from "vitest";

import {
  executeLiveProviderRequest,
  LiveRequestBudget,
  loadLiveTestPlan,
  shouldRunLiveScenario
} from "./provider-test-harness.js";

const plan = loadLiveTestPlan();

describe.skipIf(plan.enabled)("live provider tests are disabled", () => {
  it("requires VOXMESH_LIVE_TESTS=true before loading credentials", () => {
    expect(plan).toEqual({
      enabled: false,
      providers: [],
      capabilities: [],
      maximumRequests: 0
    });
  });
});

describe.skipIf(!plan.enabled)("opt-in live provider harness", () => {
  it("validates selected scenarios with a deterministic provider double", async () => {
    const budget = new LiveRequestBudget(plan.maximumRequests);
    const selectedScenarioCount = plan.providers.flatMap((provider) =>
      plan.capabilities.filter((capability) =>
        shouldRunLiveScenario(plan, provider, capability)
      )
    ).length;
    const response = await executeLiveProviderRequest(
      {
        label: "offline harness self-test",
        timeoutMs: 1_000,
        budget
      },
      async () => "offline deterministic response"
    );

    expect(selectedScenarioCount).toBeGreaterThan(0);
    expect(response).toBe("offline deterministic response");
    expect(budget.remaining).toBe(plan.maximumRequests - 1);
  });
});
