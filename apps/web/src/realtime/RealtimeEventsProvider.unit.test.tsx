// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEntry } from "@voxmesh/shared";

import { queryKeys } from "../query.js";
import {
  RealtimeEventsProvider,
  mergeLogEntries,
  useRealtimeEvents
} from "./RealtimeEventsProvider.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RealtimeEventsProvider", () => {
  it("updates query caches and exposes connection and gap states", () => {
    const sockets: FakeBrowserSocket[] = [];
    vi.stubGlobal(
      "WebSocket",
      class extends FakeBrowserSocket {
        public static readonly OPEN = 1;

        public constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      }
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    queryClient.setQueryData(queryKeys.logs, []);
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeEventsProvider onAuthenticationRequired={vi.fn()}>
          <StatusProbe />
        </RealtimeEventsProvider>
      </QueryClientProvider>
    );

    act(() => sockets[0]?.message(ready()));
    expect(screen.getByText("connected")).toBeVisible();

    act(() => sockets[0]?.message(logEvent(1)));
    expect(
      queryClient.getQueryData<LogEntry[]>(queryKeys.logs)?.[0]
    ).toMatchObject({ id: "log-1", message: "Live event" });

    act(() =>
      sockets[0]?.message({
        version: 1,
        type: "stream.gap",
        streamId: "stream-1",
        requestedAfter: 1,
        oldestAvailableSequence: 5,
        latestSequence: 8
      })
    );
    expect(screen.getByText("gap 5-8")).toBeVisible();
    act(() => sockets[0]?.message({ ...ready(), streamId: "stream-2" }));
    expect(screen.getByText("restarted")).toBeVisible();
  });

  it("merges, de-duplicates, and orders live log entries", () => {
    const old = log("old", "2026-08-21T00:00:00.000Z");
    const recent = log("recent", "2026-08-21T00:00:02.000Z");

    expect(mergeLogEntries([old], recent).map((entry) => entry.id)).toEqual([
      "recent",
      "old"
    ]);
    expect(mergeLogEntries([old], { ...old, message: "Updated" })).toEqual([
      { ...old, message: "Updated" }
    ]);
  });

  it("does not create a partial log cache before the snapshot is loaded", () => {
    const sockets: FakeBrowserSocket[] = [];
    vi.stubGlobal(
      "WebSocket",
      class extends FakeBrowserSocket {
        public static readonly OPEN = 1;

        public constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      }
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeEventsProvider onAuthenticationRequired={vi.fn()}>
          <StatusProbe />
        </RealtimeEventsProvider>
      </QueryClientProvider>
    );

    act(() => sockets[0]?.message(ready()));
    act(() => {
      for (let sequence = 1; sequence <= 205; sequence += 1) {
        sockets[0]?.message(logEvent(sequence));
      }
    });

    expect(queryClient.getQueryData(queryKeys.logs)).toBeUndefined();
    act(() => {
      queryClient.setQueryData(queryKeys.logs, [
        log("snapshot", "2026-08-21T00:00:00.000Z")
      ]);
    });
    const merged = queryClient.getQueryData<LogEntry[]>(queryKeys.logs);
    expect(merged).toHaveLength(200);
    expect(merged?.[0]?.id).toBe("log-205");
  });

  it("merges live events that arrive during an existing-cache refetch", async () => {
    const sockets: FakeBrowserSocket[] = [];
    vi.stubGlobal(
      "WebSocket",
      class extends FakeBrowserSocket {
        public static readonly OPEN = 1;

        public constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      }
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    queryClient.setQueryData(queryKeys.logs, [
      log("old-cache", "2026-08-21T00:00:00.000Z")
    ]);
    let resolveSnapshot: ((logs: LogEntry[]) => void) | undefined;
    const refetch = queryClient.fetchQuery({
      queryKey: queryKeys.logs,
      queryFn: () =>
        new Promise<LogEntry[]>((resolve) => {
          resolveSnapshot = resolve;
        })
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeEventsProvider onAuthenticationRequired={vi.fn()}>
          <StatusProbe />
        </RealtimeEventsProvider>
      </QueryClientProvider>
    );
    act(() => sockets[0]?.message(ready()));
    act(() => sockets[0]?.message(logEvent(10)));
    act(() => {
      queryClient.setQueryData(["unrelated"], { changed: true });
    });
    expect(
      queryClient
        .getQueryData<LogEntry[]>(queryKeys.logs)
        ?.map((entry) => entry.id)
    ).toEqual(["old-cache"]);
    resolveSnapshot?.([log("stale-snapshot", "2026-08-21T00:00:00.005Z")]);
    await refetch;

    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<LogEntry[]>(queryKeys.logs)
          ?.map((entry) => entry.id)
      ).toEqual(["log-10", "stale-snapshot"])
    );
  });
});

function StatusProbe() {
  const realtime = useRealtimeEvents();
  return (
    <div>
      <span>{realtime.status}</span>
      {realtime.gap ? (
        <span>
          gap {realtime.gap.oldestAvailableSequence}-
          {realtime.gap.latestSequence}
        </span>
      ) : null}
      {realtime.streamRestarted ? <span>restarted</span> : null}
    </div>
  );
}

class FakeBrowserSocket {
  public readonly readyState = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;

  public constructor(public readonly url: string) {}

  public close(): void {
    return undefined;
  }

  public message(value: unknown): void {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(value) })
    );
  }
}

function ready() {
  return {
    version: 1,
    type: "stream.ready",
    streamId: "stream-1",
    latestSequence: 0,
    oldestAvailableSequence: null
  };
}

function logEvent(sequence: number) {
  const createdAt = new Date(
    Date.UTC(2026, 7, 21, 0, 0, 0, sequence)
  ).toISOString();
  return {
    version: 1,
    type: "stream.event",
    event: {
      version: 1,
      streamId: "stream-1",
      sequence,
      eventId: `event-${sequence}`,
      emittedAt: createdAt,
      type: "log.created",
      payload: {
        log: log(`log-${sequence}`, createdAt)
      }
    }
  };
}

function log(id: string, createdAt: string): LogEntry {
  return {
    id,
    category: "SYSTEM",
    level: "INFO",
    message: id === "log-1" ? "Live event" : id,
    conversationId: null,
    createdAt
  };
}
