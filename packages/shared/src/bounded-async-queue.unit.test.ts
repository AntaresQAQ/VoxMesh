import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BoundedAsyncQueue,
  BoundedQueueError,
  type BoundedQueueErrorCode
} from "./bounded-async-queue.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BoundedAsyncQueue", () => {
  it("preserves FIFO order and applies producer backpressure", async () => {
    const queue = createQueue();
    await queue.enqueue("a");
    let secondAccepted = false;
    const second = queue.enqueue("b").then(() => {
      secondAccepted = true;
    });

    expect(queue.size).toBe(1);
    expect(queue.pendingProducers).toBe(1);
    expect(secondAccepted).toBe(false);
    await expect(queue.dequeue()).resolves.toBe("a");
    await second;
    expect(secondAccepted).toBe(true);
    await expect(queue.dequeue()).resolves.toBe("b");
  });

  it("bounds pending producers instead of growing an unlimited wait list", async () => {
    const queue = createQueue();
    await queue.enqueue("a");
    const pending = queue.enqueue("b");

    expectQueueError(() => queue.enqueue("c"), "QUEUE_FULL");
    await queue.dequeue();
    await pending;
  });

  it("notifies high and low pressure transitions", async () => {
    const queue = createQueue({
      highWaterMark: 0.5,
      lowWaterMark: 0.25
    });
    const pressure: string[] = [];
    queue.subscribePressure((value) => pressure.push(value));

    await queue.enqueue("a");
    expect(queue.queuedBytes).toBe(1);
    expect(queue.queuedDurationMs).toBe(1);
    await queue.dequeue();
    expect(queue.queuedBytes).toBe(0);
    expect(queue.queuedDurationMs).toBe(0);

    expect(pressure).toEqual(["normal", "high", "normal"]);
  });

  it("isolates pressure listener failures from queue mutation", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const queue = createQueue({
      highWaterMark: 0.5,
      lowWaterMark: 0.25
    });
    queue.subscribePressure((pressure) => {
      if (pressure === "high") throw new Error("listener failed");
    });

    await queue.enqueue("a");
    const pending = queue.enqueue("b");
    await expect(queue.dequeue()).resolves.toBe("a");
    await pending;
    await expect(queue.dequeue()).resolves.toBe("b");

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("cancels blocked producers and consumers", async () => {
    const queue = createQueue();
    await queue.enqueue("a");
    const producerAbort = new AbortController();
    const producer = queue.enqueue("b", {
      signal: producerAbort.signal
    });
    producerAbort.abort();
    await expect(producer).rejects.toMatchObject({ code: "CANCELLED" });

    await queue.dequeue();
    const consumerAbort = new AbortController();
    const consumer = queue.dequeue({ signal: consumerAbort.signal });
    consumerAbort.abort();
    await expect(consumer).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("times out blocked waits and removes their reservations", async () => {
    vi.useFakeTimers();
    const queue = createQueue();
    await queue.enqueue("a");
    const pending = queue.enqueue("b", { timeoutMs: 25 });
    const expected = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.advanceTimersByTimeAsync(25);

    await expected;
    expect(queue.pendingProducers).toBe(0);
  });

  it("validates timeout before attaching an AbortSignal listener", async () => {
    const queue = createQueue();
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, "addEventListener");

    await expect(
      queue.dequeue({ signal: controller.signal, timeoutMs: -1 })
    ).rejects.toThrow("Queue timeout");
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it("drains gracefully after close", async () => {
    const queue = createQueue();
    await queue.enqueue("a");
    queue.close();

    expectQueueError(() => queue.enqueue("b"), "QUEUE_CLOSED");
    await expect(queue.dequeue()).resolves.toBe("a");
    await expect(queue.dequeue()).resolves.toBeNull();
  });

  it("fails every waiter and discards queued items", async () => {
    const queue = createQueue();
    await queue.enqueue("a");
    const producer = queue.enqueue("b");
    const expected = expect(producer).rejects.toMatchObject({
      code: "QUEUE_FAILED"
    });

    queue.fail(new Error("provider failed"));

    await expected;
    await expect(queue.dequeue()).rejects.toMatchObject({
      code: "QUEUE_FAILED"
    });
    expect(queue.size).toBe(0);
  });

  it("supports async iteration until graceful close", async () => {
    const queue = createQueue({
      maxItems: 2,
      maxBytes: 2,
      maxDurationMs: 2
    });
    await queue.enqueue("a");
    await queue.enqueue("b");
    queue.close();

    const values: string[] = [];
    for await (const value of queue) values.push(value);

    expect(values).toEqual(["a", "b"]);
  });

  it("rejects invalid limits, measurements, and oversized items", () => {
    expect(() =>
      createQueue({ highWaterMark: 0.5, lowWaterMark: 0.5 })
    ).toThrow("Queue water marks");
    expect(() => createQueue({ highWaterMark: Number.NaN })).toThrow(
      "Queue water marks"
    );
    expect(() =>
      new BoundedAsyncQueue(
        { maxItems: 1, maxBytes: 1, maxDurationMs: 1 },
        () => ({ bytes: Number.NaN, durationMs: 0 })
      ).enqueue("a")
    ).toThrow("Queue measurements");
    expectQueueError(
      () => createQueue().enqueue("too-large"),
      "ITEM_TOO_LARGE"
    );
  });
});

function createQueue(
  overrides: Partial<{
    maxItems: number;
    maxBytes: number;
    maxDurationMs: number;
    maxPendingItems: number;
    maxPendingBytes: number;
    maxPendingDurationMs: number;
    highWaterMark: number;
    lowWaterMark: number;
  }> = {}
): BoundedAsyncQueue<string> {
  return new BoundedAsyncQueue(
    {
      maxItems: 1,
      maxBytes: 1,
      maxDurationMs: 1,
      maxPendingItems: 1,
      maxPendingBytes: 1,
      maxPendingDurationMs: 1,
      ...overrides
    },
    (value) => ({ bytes: value.length, durationMs: 1 })
  );
}

function expectQueueError(
  action: () => unknown,
  code: BoundedQueueErrorCode
): void {
  try {
    action();
    throw new Error("Expected a BoundedQueueError");
  } catch (error) {
    expect(error).toBeInstanceOf(BoundedQueueError);
    expect(error).toMatchObject({ code });
  }
}
