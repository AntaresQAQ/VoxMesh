import { randomUUID } from "node:crypto";

import type { EventStreamMessage, RealtimeEvent } from "@voxmesh/shared";
import type { StorageObservabilityEvent } from "@voxmesh/storage";

export interface RealtimeEventSnapshot {
  ready: Extract<EventStreamMessage, { type: "stream.ready" }>;
  gap?: Extract<EventStreamMessage, { type: "stream.gap" }>;
  events: RealtimeEvent[];
}

/** Maintains a bounded in-memory replay window for persisted domain events. */
export class RealtimeEventHub {
  private readonly streamId = randomUUID();
  private readonly events: RealtimeEvent[] = [];
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();
  private nextSequence = 1;

  public constructor(private readonly capacity = 500) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Realtime event capacity must be a positive integer");
    }
  }

  public publish(event: StorageObservabilityEvent): RealtimeEvent {
    const published = toRealtimeEvent(event, this.streamId, this.nextSequence);
    this.nextSequence += 1;
    this.events.push(published);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
    for (const listener of this.listeners) {
      try {
        listener(published);
      } catch (error) {
        console.error("Realtime event listener failed", error);
      }
    }
    return published;
  }

  public snapshot(afterSequence: number): RealtimeEventSnapshot {
    const latestSequence = this.nextSequence - 1;
    const oldestAvailableSequence = this.events[0]?.sequence ?? null;
    const gap =
      oldestAvailableSequence !== null &&
      afterSequence < oldestAvailableSequence - 1
        ? {
            version: 1 as const,
            type: "stream.gap" as const,
            streamId: this.streamId,
            requestedAfter: afterSequence,
            oldestAvailableSequence,
            latestSequence
          }
        : undefined;
    return {
      ready: {
        version: 1,
        type: "stream.ready",
        streamId: this.streamId,
        latestSequence,
        oldestAvailableSequence
      },
      ...(gap ? { gap } : {}),
      events: this.events.filter((event) => event.sequence > afterSequence)
    };
  }

  public subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public latestSequence(): number {
    return this.nextSequence - 1;
  }

  public streamIdentifier(): string {
    return this.streamId;
  }
}

function toRealtimeEvent(
  event: StorageObservabilityEvent,
  streamId: string,
  sequence: number
): RealtimeEvent {
  const common = {
    version: 1 as const,
    streamId,
    sequence,
    eventId: randomUUID(),
    emittedAt: new Date().toISOString()
  };
  return event.type === "log.created"
    ? {
        ...common,
        type: "log.created",
        payload: { log: event.log }
      }
    : {
        ...common,
        type: "pipeline.created",
        payload: {
          conversationId: event.conversationId,
          event: event.event
        }
      };
}
