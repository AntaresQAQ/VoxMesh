import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import type {
  EventStreamMessage,
  LogEntry,
  RealtimeEvent
} from "@voxmesh/shared";

import { apiClient, ApiClientError } from "../api.js";
import { queryKeys } from "../query.js";
import {
  EventStreamClient,
  type EventStreamStatus
} from "./event-stream-client.js";

export interface RealtimeEventsState {
  status: EventStreamStatus;
  gap: Extract<EventStreamMessage, { type: "stream.gap" }> | null;
  streamRestarted: boolean;
  error: string;
  clearGap(): void;
  clearStreamRestart(): void;
}

const RealtimeEventsContext = createContext<RealtimeEventsState>({
  status: "disconnected",
  gap: null,
  streamRestarted: false,
  error: "",
  clearGap: () => undefined,
  clearStreamRestart: () => undefined
});

export function RealtimeEventsProvider(props: {
  children: ReactNode;
  onAuthenticationRequired: () => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EventStreamStatus>("connecting");
  const [gap, setGap] = useState<Extract<
    EventStreamMessage,
    { type: "stream.gap" }
  > | null>(null);
  const [streamRestarted, setStreamRestarted] = useState(false);
  const [error, setError] = useState("");
  const pendingLogs = useRef<LogEntry[]>([]);

  useEffect(() => {
    const unsubscribeQueryCache = queryClient.getQueryCache().subscribe(() => {
      if (pendingLogs.current.length === 0) return;
      if (
        queryClient.getQueryState(queryKeys.logs)?.fetchStatus === "fetching"
      ) {
        return;
      }
      const current = queryClient.getQueryData<LogEntry[]>(queryKeys.logs);
      if (current === undefined) return;
      const pending = pendingLogs.current.splice(0);
      queryClient.setQueryData<LogEntry[]>(
        queryKeys.logs,
        pending.reduce(mergeLogEntries, current)
      );
    });
    const client = new EventStreamClient({
      onStatus: setStatus,
      onEvent: (event) =>
        applyRealtimeEvent(queryClient, event, pendingLogs.current),
      onGap: (nextGap) => {
        setGap(nextGap);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.logs }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.conversations
          })
        ]);
      },
      onStreamReset: () => {
        setStreamRestarted(true);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.logs }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.conversations
          })
        ]);
      },
      onAuthenticationRequired: props.onAuthenticationRequired,
      onProtocolError: setError,
      verifyAuthentication: async () => {
        try {
          await apiClient.session();
          return true;
        } catch (caught) {
          return caught instanceof ApiClientError &&
            caught.code === "AUTHENTICATION_REQUIRED"
            ? false
            : null;
        }
      }
    });
    client.start();
    return () => {
      unsubscribeQueryCache();
      client.stop();
    };
  }, [props.onAuthenticationRequired, queryClient]);

  return (
    <RealtimeEventsContext.Provider
      value={{
        status,
        gap,
        streamRestarted,
        error,
        clearGap: () => setGap(null),
        clearStreamRestart: () => setStreamRestarted(false)
      }}
    >
      {props.children}
    </RealtimeEventsContext.Provider>
  );
}

export function useRealtimeEvents(): RealtimeEventsState {
  return useContext(RealtimeEventsContext);
}

export function mergeLogEntries(
  current: LogEntry[] | undefined,
  incoming: LogEntry
): LogEntry[] {
  const byId = new Map((current ?? []).map((log) => [log.id, log]));
  byId.set(incoming.id, incoming);
  return [...byId.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 200);
}

function applyRealtimeEvent(
  queryClient: ReturnType<typeof useQueryClient>,
  event: RealtimeEvent,
  pendingLogs: LogEntry[]
): void {
  if (event.type === "log.created") {
    const current = queryClient.getQueryData<LogEntry[]>(queryKeys.logs);
    const fetching =
      queryClient.getQueryState(queryKeys.logs)?.fetchStatus === "fetching";
    if (current !== undefined && !fetching) {
      queryClient.setQueryData<LogEntry[]>(queryKeys.logs, (current) =>
        [...pendingLogs.splice(0), event.payload.log].reduce(
          mergeLogEntries,
          current ?? []
        )
      );
    } else {
      pendingLogs.push(event.payload.log);
      if (pendingLogs.length > 200) {
        pendingLogs.splice(0, pendingLogs.length - 200);
      }
      if (current === undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.logs });
      }
    }
    return;
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.conversation(event.payload.conversationId)
  });
}
