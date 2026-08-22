import { describe, expect, it } from "vitest";

import { LiveTestRequestError } from "./provider-test-harness.js";
import { recordQualificationEvidence } from "./qualification-evidence.js";

describe("qualification evidence", () => {
  it("emits only allow-listed success metadata", async () => {
    const lines: string[] = [];
    const times = [
      new Date("2026-08-22T07:00:00.000Z"),
      new Date("2026-08-22T07:00:01.250Z")
    ];

    await expect(
      recordQualificationEvidence(
        "azure-openai",
        "chat-direct",
        async () => "secret provider response",
        {
          now: () => times.shift() ?? new Date(0),
          write: (line) => lines.push(line)
        }
      )
    ).resolves.toBe("secret provider response");

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret provider response");
    expect(
      JSON.parse(lines[0]?.replace("VOXMESH_LIVE_EVIDENCE ", "") ?? "")
    ).toEqual({
      providerFamily: "azure-openai",
      capability: "chat-direct",
      regionCategory: "operator-configured",
      modelFamily: "operator-configured",
      testedAt: "2026-08-22T07:00:01.250Z",
      outcome: "passed",
      durationMs: 1_250,
      errorCategory: null
    });
  });

  it("emits only the safe category when a scenario fails", async () => {
    const lines: string[] = [];
    const error = new LiveTestRequestError(
      "authentication",
      "Provider authentication failed."
    );

    await expect(
      recordQualificationEvidence(
        "azure-openai",
        "stt",
        async () => {
          throw error;
        },
        {
          now: () => new Date("2026-08-22T07:00:00.000Z"),
          write: (line) => lines.push(line)
        }
      )
    ).rejects.toBe(error);

    expect(lines[0]).not.toContain(error.message);
    expect(
      JSON.parse(lines[0]?.replace("VOXMESH_LIVE_EVIDENCE ", "") ?? "")
    ).toMatchObject({
      providerFamily: "azure-openai",
      capability: "stt",
      outcome: "failed",
      errorCategory: "authentication"
    });
  });
});
