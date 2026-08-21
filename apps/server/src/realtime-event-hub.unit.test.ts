import { describe, expect, it, vi } from "vitest";

import { RealtimeEventHub } from "./realtime-event-hub.js";

describe("RealtimeEventHub", () => {
  it("assigns monotonic sequences and replays events after a cursor", () => {
    const hub = new RealtimeEventHub(3);
    hub.publish(logEvent("one"));
    hub.publish(logEvent("two"));
    hub.publish(logEvent("three"));

    const snapshot = hub.snapshot(1);

    expect(typeof snapshot.ready.streamId).toBe("string");
    expect(snapshot.ready).toMatchObject({
      latestSequence: 3,
      oldestAvailableSequence: 1
    });
    expect(snapshot.gap).toBeUndefined();
    expect(snapshot.events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it("reports a gap after the replay window overflows", () => {
    const hub = new RealtimeEventHub(2);
    hub.publish(logEvent("one"));
    hub.publish(logEvent("two"));
    hub.publish(logEvent("three"));

    const snapshot = hub.snapshot(0);

    expect(typeof snapshot.gap?.streamId).toBe("string");
    expect(snapshot.gap).toMatchObject({
      version: 1,
      type: "stream.gap",
      requestedAfter: 0,
      oldestAvailableSequence: 2,
      latestSequence: 3
    });
    expect(snapshot.events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it("notifies active subscribers and supports unsubscribe", () => {
    const hub = new RealtimeEventHub();
    const listener = vi.fn();
    const unsubscribe = hub.subscribe(listener);

    hub.publish(logEvent("one"));
    unsubscribe();
    hub.publish(logEvent("two"));

    expect(listener).toHaveBeenCalledOnce();
  });

  it("isolates a failing subscriber from other clients", () => {
    const hub = new RealtimeEventHub();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const healthy = vi.fn();
    hub.subscribe(() => {
      throw new Error("broken subscriber");
    });
    hub.subscribe(healthy);

    expect(() => hub.publish(logEvent("one"))).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

function logEvent(message: string) {
  return {
    type: "log.created" as const,
    log: {
      id: `log-${message}`,
      category: "SYSTEM" as const,
      level: "INFO" as const,
      message,
      conversationId: null,
      createdAt: "2026-08-21T00:00:00.000Z"
    }
  };
}
