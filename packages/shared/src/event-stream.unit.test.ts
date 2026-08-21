import { describe, expect, it } from "vitest";

import { parseEventStreamMessage } from "./event-stream.js";

describe("event stream parsing", () => {
  it("accepts a valid log event", () => {
    expect(
      parseEventStreamMessage(
        JSON.stringify({
          version: 1,
          type: "stream.event",
          event: {
            version: 1,
            streamId: "stream-1",
            sequence: 1,
            eventId: "event-1",
            emittedAt: "2026-08-21T00:00:00.000Z",
            type: "log.created",
            payload: {
              log: {
                id: "log-1",
                category: "SYSTEM",
                level: "INFO",
                message: "Started",
                conversationId: null,
                createdAt: "2026-08-21T00:00:00.000Z"
              }
            }
          }
        })
      )
    ).toMatchObject({ type: "stream.event" });
  });

  it.each(["started", "completed", "failed", "cancelled"] as const)(
    "accepts a %s pipeline event with run metadata",
    (status) => {
      expect(
        parseEventStreamMessage(
          JSON.stringify({
            version: 1,
            type: "stream.event",
            event: {
              version: 1,
              streamId: "stream-1",
              sequence: 1,
              eventId: "event-1",
              emittedAt: "2026-08-21T00:00:00.000Z",
              type: "pipeline.created",
              payload: {
                conversationId: "conversation-1",
                event: {
                  id: "pipeline-1",
                  runId: "11111111-1111-4111-8111-111111111111",
                  correlationId: "22222222-2222-4222-8222-222222222222",
                  stage: "AGENT",
                  status,
                  durationMs: status === "started" ? null : 100,
                  message: `Agent ${status}`,
                  createdAt: "2026-08-21T00:00:00.000Z"
                }
              }
            }
          })
        )
      ).toMatchObject({ type: "stream.event" });
    }
  );

  it("rejects malformed or unknown messages", () => {
    expect(parseEventStreamMessage("{")).toBeNull();
    expect(
      parseEventStreamMessage(JSON.stringify({ version: 1, type: "unknown" }))
    ).toBeNull();
    expect(
      parseEventStreamMessage(
        JSON.stringify({
          version: 1,
          type: "stream.event",
          event: { sequence: 0 }
        })
      )
    ).toBeNull();
    expect(
      parseEventStreamMessage(
        JSON.stringify({
          version: 1,
          type: "stream.heartbeat",
          streamId: "stream-1",
          emittedAt: "not-a-date",
          latestSequence: 1
        })
      )
    ).toBeNull();
  });
});
