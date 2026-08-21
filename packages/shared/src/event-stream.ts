import type {
  EventStreamMessage,
  ConversationRun,
  LogEntry,
  Message,
  PipelineEvent,
  RealtimeEvent
} from "./schemas.js";

export type { EventStreamMessage, RealtimeEvent } from "./schemas.js";

/** Parses untrusted server event-stream JSON without accepting unknown shapes. */
export function parseEventStreamMessage(
  input: string
): EventStreamMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  return isEventStreamMessage(value) ? value : null;
}

function isEventStreamMessage(value: unknown): value is EventStreamMessage {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.type !== "string"
  ) {
    return false;
  }
  switch (value.type) {
    case "stream.ready":
      return (
        typeof value.streamId === "string" &&
        isNonNegativeInteger(value.latestSequence) &&
        (value.oldestAvailableSequence === null ||
          isPositiveInteger(value.oldestAvailableSequence))
      );
    case "stream.event":
      return isRealtimeEvent(value.event);
    case "stream.gap":
      return (
        typeof value.streamId === "string" &&
        isNonNegativeInteger(value.requestedAfter) &&
        isPositiveInteger(value.oldestAvailableSequence) &&
        isPositiveInteger(value.latestSequence)
      );
    case "stream.heartbeat":
      return (
        typeof value.streamId === "string" &&
        isDateTimeString(value.emittedAt) &&
        isNonNegativeInteger(value.latestSequence)
      );
    case "stream.error":
      return (
        typeof value.code === "string" && typeof value.message === "string"
      );
    default:
      return false;
  }
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.streamId !== "string" ||
    !isPositiveInteger(value.sequence) ||
    typeof value.eventId !== "string" ||
    !isDateTimeString(value.emittedAt) ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  if (value.type === "log.created") {
    return isLogEntry(value.payload.log);
  }
  if (value.type === "pipeline.created") {
    return (
      typeof value.payload.conversationId === "string" &&
      isPipelineEvent(value.payload.event)
    );
  }
  if (value.type === "run.created" || value.type === "run.updated") {
    return isConversationRun(value.payload.run);
  }
  if (value.type === "message.created") {
    return (
      typeof value.payload.conversationId === "string" &&
      isMessage(value.payload.message)
    );
  }
  return false;
}

function isConversationRun(value: unknown): value is ConversationRun {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.conversationId === "string" &&
    (value.kind === "chat" ||
      value.kind === "voice-composed" ||
      value.kind === "voice-native") &&
    (value.status === "in_progress" ||
      value.status === "completed" ||
      value.status === "failed" ||
      value.status === "cancelled") &&
    typeof value.correlationId === "string" &&
    (value.inputMessageId === null ||
      typeof value.inputMessageId === "string") &&
    (value.retryOfRunId === null || typeof value.retryOfRunId === "string") &&
    isDateTimeString(value.startedAt) &&
    (value.completedAt === null || isDateTimeString(value.completedAt)) &&
    (value.durationMs === null || isNonNegativeInteger(value.durationMs)) &&
    (value.errorCode === null || typeof value.errorCode === "string")
  );
}

function isMessage(value: unknown): value is Message {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" ||
      value.role === "assistant" ||
      value.role === "tool") &&
    (value.runId === null || typeof value.runId === "string") &&
    typeof value.content === "string" &&
    isDateTimeString(value.createdAt)
  );
}

function isLogEntry(value: unknown): value is LogEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isLogCategory(value.category) &&
    isLogLevel(value.level) &&
    typeof value.message === "string" &&
    (value.conversationId === null ||
      typeof value.conversationId === "string") &&
    isDateTimeString(value.createdAt)
  );
}

function isPipelineEvent(value: unknown): value is PipelineEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.runId === null || typeof value.runId === "string") &&
    (value.correlationId === null || typeof value.correlationId === "string") &&
    isPipelineStage(value.stage) &&
    (value.status === "started" ||
      value.status === "completed" ||
      value.status === "failed" ||
      value.status === "cancelled") &&
    (value.durationMs === null || isNonNegativeInteger(value.durationMs)) &&
    typeof value.message === "string" &&
    isDateTimeString(value.createdAt)
  );
}

function isLogCategory(value: unknown): value is LogEntry["category"] {
  return (
    value === "AGENT" ||
    value === "MCP" ||
    value === "AUTH" ||
    value === "SYSTEM" ||
    value === "ERROR"
  );
}

function isLogLevel(value: unknown): value is LogEntry["level"] {
  return value === "INFO" || value === "WARN" || value === "ERROR";
}

function isPipelineStage(value: unknown): value is PipelineEvent["stage"] {
  return (
    value === "STT" || value === "AGENT" || value === "MCP" || value === "TTS"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isDateTimeString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}
