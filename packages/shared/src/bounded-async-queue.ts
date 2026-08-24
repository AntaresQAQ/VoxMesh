export type BoundedQueuePressure = "normal" | "high";

export interface BoundedQueueMeasurement {
  bytes: number;
  durationMs: number;
}

export interface BoundedAsyncQueueLimits {
  maxItems: number;
  maxBytes: number;
  maxDurationMs: number;
  maxPendingItems?: number;
  maxPendingBytes?: number;
  maxPendingDurationMs?: number;
  highWaterMark?: number;
  lowWaterMark?: number;
}

export interface BoundedQueueWaitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type BoundedQueueErrorCode =
  | "ITEM_TOO_LARGE"
  | "QUEUE_FULL"
  | "QUEUE_CLOSED"
  | "QUEUE_FAILED"
  | "TIMEOUT"
  | "CANCELLED";

export class BoundedQueueError extends Error {
  public constructor(
    public readonly code: BoundedQueueErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "BoundedQueueError";
  }
}

interface QueueEntry<T> {
  value: T;
  measurement: BoundedQueueMeasurement;
}

interface ProducerWaiter<T> extends QueueEntry<T> {
  resolve(): void;
  reject(error: Error): void;
  cleanup(): void;
}

interface ConsumerWaiter<T> {
  resolve(value: T | null): void;
  reject(error: Error): void;
  cleanup(): void;
}

interface QueueTotals {
  bytes: number;
  durationMs: number;
}

/**
 * A FIFO async queue with bounded queued and pending-producer memory.
 *
 * Producers wait for capacity instead of dropping items. Pending producers are
 * separately bounded so backpressure cannot create an unbounded wait list.
 */
export class BoundedAsyncQueue<T> implements AsyncIterable<T> {
  private readonly limits: Required<BoundedAsyncQueueLimits>;
  private readonly items: QueueEntry<T>[] = [];
  private readonly producers: ProducerWaiter<T>[] = [];
  private readonly consumers: ConsumerWaiter<T>[] = [];
  private readonly pressureListeners = new Set<
    (pressure: BoundedQueuePressure) => void
  >();
  private readonly queued: QueueTotals = { bytes: 0, durationMs: 0 };
  private readonly pending: QueueTotals = { bytes: 0, durationMs: 0 };
  private state: "open" | "closed" | "failed" = "open";
  private failure: BoundedQueueError | null = null;
  private pressure: BoundedQueuePressure = "normal";

  public constructor(
    limits: BoundedAsyncQueueLimits,
    private readonly measure: (value: T) => BoundedQueueMeasurement
  ) {
    validateLimits(limits);
    this.limits = {
      ...limits,
      maxPendingItems: limits.maxPendingItems ?? limits.maxItems,
      maxPendingBytes: limits.maxPendingBytes ?? limits.maxBytes,
      maxPendingDurationMs: limits.maxPendingDurationMs ?? limits.maxDurationMs,
      highWaterMark: limits.highWaterMark ?? 0.75,
      lowWaterMark: limits.lowWaterMark ?? 0.5
    };
    if (
      !Number.isFinite(this.limits.lowWaterMark) ||
      !Number.isFinite(this.limits.highWaterMark) ||
      this.limits.lowWaterMark < 0 ||
      this.limits.highWaterMark > 1 ||
      this.limits.lowWaterMark >= this.limits.highWaterMark
    ) {
      throw new Error("Queue water marks must satisfy 0 <= low < high <= 1");
    }
  }

  public get size(): number {
    return this.items.length;
  }

  public get pendingProducers(): number {
    return this.producers.length;
  }

  public get currentPressure(): BoundedQueuePressure {
    return this.pressure;
  }

  public enqueue(
    value: T,
    options: BoundedQueueWaitOptions = {}
  ): Promise<void> {
    this.throwIfNotOpen();
    throwIfAborted(options.signal);
    const entry = {
      value,
      measurement: validateMeasurement(this.measure(value))
    };
    if (!this.fitsSingleItem(entry.measurement)) {
      throw new BoundedQueueError(
        "ITEM_TOO_LARGE",
        "Queue item exceeds an individual queue limit"
      );
    }
    if (this.producers.length === 0 && this.acceptEntry(entry)) {
      return Promise.resolve();
    }
    if (!this.fitsPending(entry.measurement)) {
      throw new BoundedQueueError(
        "QUEUE_FULL",
        "Queue pending-producer limit was reached"
      );
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = this.createProducer(entry, resolve, reject, options);
      this.producers.push(waiter);
      addTotals(this.pending, entry.measurement);
      this.updatePressure();
    });
  }

  public dequeue(options: BoundedQueueWaitOptions = {}): Promise<T | null> {
    throwIfAborted(options.signal);
    if (this.failure) return Promise.reject(this.failure);
    const entry = this.items.shift();
    if (entry) {
      subtractTotals(this.queued, entry.measurement);
      this.flushProducers();
      this.updatePressure();
      return Promise.resolve(entry.value);
    }
    if (this.state === "closed") return Promise.resolve(null);
    return new Promise<T | null>((resolve, reject) => {
      this.consumers.push(this.createConsumer(resolve, reject, options));
    });
  }

  /** Stops new writes and lets queued items drain before readers receive null. */
  public close(): void {
    if (this.state !== "open") return;
    this.state = "closed";
    this.rejectProducers(
      new BoundedQueueError("QUEUE_CLOSED", "Queue was closed")
    );
    if (this.items.length === 0) this.resolveConsumersAsClosed();
    this.updatePressure();
  }

  /** Fails the queue, discards queued items, and wakes every waiter. */
  public fail(cause: unknown): void {
    if (this.state === "failed") return;
    this.state = "failed";
    this.failure =
      cause instanceof BoundedQueueError
        ? cause
        : new BoundedQueueError("QUEUE_FAILED", "Queue failed", { cause });
    this.items.length = 0;
    this.queued.bytes = 0;
    this.queued.durationMs = 0;
    this.rejectProducers(this.failure);
    for (const consumer of this.consumers.splice(0)) {
      consumer.cleanup();
      consumer.reject(this.failure);
    }
    this.updatePressure();
  }

  public subscribePressure(
    listener: (pressure: BoundedQueuePressure) => void
  ): () => void {
    this.pressureListeners.add(listener);
    notifyPressureListener(listener, this.pressure);
    return () => this.pressureListeners.delete(listener);
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const value = await this.dequeue();
      if (value === null) return;
      yield value;
    }
  }

  private acceptEntry(entry: QueueEntry<T>): boolean {
    const consumer = this.consumers.shift();
    if (consumer) {
      consumer.cleanup();
      consumer.resolve(entry.value);
      return true;
    }
    if (!this.fitsQueued(entry.measurement)) return false;
    this.items.push(entry);
    addTotals(this.queued, entry.measurement);
    this.updatePressure();
    return true;
  }

  private flushProducers(): void {
    while (this.producers.length > 0 && this.state === "open") {
      const producer = this.producers[0];
      if (!producer || !this.canAcceptEntry(producer)) return;
      this.producers.shift();
      subtractTotals(this.pending, producer.measurement);
      producer.cleanup();
      this.acceptEntry(producer);
      producer.resolve();
    }
    if (this.state === "closed" && this.items.length === 0) {
      this.resolveConsumersAsClosed();
    }
  }

  private canAcceptEntry(entry: QueueEntry<T>): boolean {
    return this.consumers.length > 0 || this.fitsQueued(entry.measurement);
  }

  private fitsSingleItem(measurement: BoundedQueueMeasurement): boolean {
    return (
      measurement.bytes <= this.limits.maxBytes &&
      measurement.durationMs <= this.limits.maxDurationMs
    );
  }

  private fitsQueued(measurement: BoundedQueueMeasurement): boolean {
    return (
      this.items.length + 1 <= this.limits.maxItems &&
      this.queued.bytes + measurement.bytes <= this.limits.maxBytes &&
      this.queued.durationMs + measurement.durationMs <=
        this.limits.maxDurationMs
    );
  }

  private fitsPending(measurement: BoundedQueueMeasurement): boolean {
    return (
      this.producers.length + 1 <= this.limits.maxPendingItems &&
      this.pending.bytes + measurement.bytes <= this.limits.maxPendingBytes &&
      this.pending.durationMs + measurement.durationMs <=
        this.limits.maxPendingDurationMs
    );
  }

  private createProducer(
    entry: QueueEntry<T>,
    resolve: () => void,
    reject: (error: Error) => void,
    options: BoundedQueueWaitOptions
  ): ProducerWaiter<T> {
    const waiter: ProducerWaiter<T> = {
      ...entry,
      resolve,
      reject,
      cleanup: () => undefined
    };
    waiter.cleanup = createWaitCleanup(options, (error) => {
      const index = this.producers.indexOf(waiter);
      if (index < 0) return;
      this.producers.splice(index, 1);
      subtractTotals(this.pending, waiter.measurement);
      reject(error);
      this.updatePressure();
    });
    return waiter;
  }

  private createConsumer(
    resolve: (value: T | null) => void,
    reject: (error: Error) => void,
    options: BoundedQueueWaitOptions
  ): ConsumerWaiter<T> {
    const waiter: ConsumerWaiter<T> = {
      resolve,
      reject,
      cleanup: () => undefined
    };
    waiter.cleanup = createWaitCleanup(options, (error) => {
      const index = this.consumers.indexOf(waiter);
      if (index < 0) return;
      this.consumers.splice(index, 1);
      reject(error);
    });
    return waiter;
  }

  private rejectProducers(error: BoundedQueueError): void {
    for (const producer of this.producers.splice(0)) {
      producer.cleanup();
      producer.reject(error);
    }
    this.pending.bytes = 0;
    this.pending.durationMs = 0;
  }

  private resolveConsumersAsClosed(): void {
    for (const consumer of this.consumers.splice(0)) {
      consumer.cleanup();
      consumer.resolve(null);
    }
  }

  private throwIfNotOpen(): void {
    if (this.failure) throw this.failure;
    if (this.state === "closed") {
      throw new BoundedQueueError("QUEUE_CLOSED", "Queue was closed");
    }
  }

  private updatePressure(): void {
    const load = Math.max(
      (this.items.length + this.producers.length) /
        (this.limits.maxItems + this.limits.maxPendingItems),
      (this.queued.bytes + this.pending.bytes) /
        (this.limits.maxBytes + this.limits.maxPendingBytes),
      (this.queued.durationMs + this.pending.durationMs) /
        (this.limits.maxDurationMs + this.limits.maxPendingDurationMs)
    );
    const next =
      this.pressure === "normal"
        ? load >= this.limits.highWaterMark
          ? "high"
          : "normal"
        : load <= this.limits.lowWaterMark
          ? "normal"
          : "high";
    if (next === this.pressure) return;
    this.pressure = next;
    for (const listener of this.pressureListeners) {
      notifyPressureListener(listener, next);
    }
  }
}

function validateLimits(limits: BoundedAsyncQueueLimits): void {
  for (const [name, value] of Object.entries({
    maxItems: limits.maxItems,
    maxBytes: limits.maxBytes,
    maxDurationMs: limits.maxDurationMs,
    maxPendingItems: limits.maxPendingItems ?? limits.maxItems,
    maxPendingBytes: limits.maxPendingBytes ?? limits.maxBytes,
    maxPendingDurationMs: limits.maxPendingDurationMs ?? limits.maxDurationMs
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number`);
    }
  }
}

function validateMeasurement(
  measurement: BoundedQueueMeasurement
): BoundedQueueMeasurement {
  if (
    !Number.isFinite(measurement.bytes) ||
    measurement.bytes < 0 ||
    !Number.isFinite(measurement.durationMs) ||
    measurement.durationMs < 0
  ) {
    throw new Error("Queue measurements must be finite and non-negative");
  }
  return measurement;
}

function addTotals(
  totals: QueueTotals,
  measurement: BoundedQueueMeasurement
): void {
  totals.bytes += measurement.bytes;
  totals.durationMs += measurement.durationMs;
}

function subtractTotals(
  totals: QueueTotals,
  measurement: BoundedQueueMeasurement
): void {
  totals.bytes -= measurement.bytes;
  totals.durationMs -= measurement.durationMs;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new BoundedQueueError("CANCELLED", "Queue wait was cancelled");
  }
}

function createWaitCleanup(
  options: BoundedQueueWaitOptions,
  reject: (error: BoundedQueueError) => void
): () => void {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  ) {
    throw new Error("Queue timeout must be finite and non-negative");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  };
  const settle = (error: BoundedQueueError) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const onAbort = () =>
    settle(new BoundedQueueError("CANCELLED", "Queue wait was cancelled"));
  if (options.signal) {
    options.signal.addEventListener("abort", onAbort, { once: true });
  }
  if (options.timeoutMs !== undefined) {
    timer = setTimeout(
      () => settle(new BoundedQueueError("TIMEOUT", "Queue wait timed out")),
      options.timeoutMs
    );
  }
  return cleanup;
}

function notifyPressureListener(
  listener: (pressure: BoundedQueuePressure) => void,
  pressure: BoundedQueuePressure
): void {
  try {
    listener(pressure);
  } catch (error) {
    console.error("Bounded queue pressure listener failed", error);
  }
}
