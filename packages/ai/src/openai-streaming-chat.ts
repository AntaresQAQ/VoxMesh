import type {
  StreamingLlmEvent,
  StreamingLlmFailureCode,
  StreamingLlmFinishReason
} from "@voxmesh/agent-core";
import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";
import { createParser, type EventSourceMessage } from "eventsource-parser";

import { createOpenAiChatBody } from "./openai-chat.js";

const MAX_SSE_BUFFER_CHARACTERS = 128 * 1024;

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface OpenAiStreamingChatRequest {
  url: string;
  headers: Record<string, string>;
  providerName: string;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  signal: AbortSignal;
  fetcher: Fetcher;
}

/**
 * Streams one OpenAI Chat Completions response into provider-independent
 * events while bounding parser memory and closing the response body.
 */
export async function* streamOpenAiChatCompletion(
  input: OpenAiStreamingChatRequest
): AsyncGenerator<StreamingLlmEvent> {
  const timeout = AbortSignal.timeout(input.timeoutMs ?? 30_000);
  const signal = AbortSignal.any([input.signal, timeout]);
  let body: ReadableStream<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let failure: Extract<StreamingLlmEvent, { type: "failure" }> | null = null;
  let finishReason: StreamingLlmFinishReason | null = null;
  let sawDone = false;
  let usageSeen = false;

  try {
    let response: Response;
    try {
      response = await input.fetcher(input.url, {
        method: "POST",
        headers: input.headers,
        body: JSON.stringify({
          ...createOpenAiChatBody({
            messages: input.messages,
            tools: input.tools,
            ...(input.model ? { model: input.model } : {})
          }),
          stream: true,
          stream_options: { include_usage: true },
          ...(input.maxOutputTokens
            ? { max_tokens: input.maxOutputTokens }
            : {})
        }),
        signal
      });
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      throw normalizedError(
        "provider_failed",
        `${input.providerName} streaming request failed`,
        error
      );
    }

    body = response.body;
    if (!response.ok) {
      throw normalizedError(
        response.status === 408 || response.status === 504
          ? "timeout"
          : "provider_failed",
        `${input.providerName} streaming request failed (${response.status})`
      );
    }
    if (!isEventStream(response.headers.get("content-type")) || !body) {
      throw normalizedError(
        "invalid_response",
        `${input.providerName} returned an invalid streaming response`
      );
    }

    reader = body.getReader();
    const decoder = new TextDecoder();
    const messages: EventSourceMessage[] = [];
    let queuedMessageCharacters = 0;
    let parserError: Error | null = null;
    const parser = createParser({
      maxBufferSize: MAX_SSE_BUFFER_CHARACTERS,
      onError: (error) => {
        parserError = error;
      },
      onEvent: (event) => {
        queuedMessageCharacters += event.data.length;
        if (queuedMessageCharacters > MAX_SSE_BUFFER_CHARACTERS) {
          parserError = new Error("SSE event queue exceeded its limit");
          return;
        }
        messages.push(event);
      }
    });

    stream: while (true) {
      const next = await readWithAbort(reader, signal);
      if (next.done) {
        parser.feed(decoder.decode());
        parser.reset({ consume: true });
      } else {
        parser.feed(decoder.decode(next.value, { stream: true }));
      }
      if (parserError) {
        throw normalizedError(
          "invalid_response",
          `${input.providerName} returned malformed event-stream data`,
          parserError
        );
      }
      while (messages.length > 0) {
        if (signal.aborted) throw abortReason(signal);
        const message = messages.shift();
        if (!message) continue;
        queuedMessageCharacters -= message.data.length;
        if (message.data.trim() === "[DONE]") {
          sawDone = true;
          break stream;
        }
        const mapped = parsePayload(message, input.providerName);
        if (
          finishReason !== null &&
          mapped.events.some((event) => event.type !== "usage")
        ) {
          throw normalizedError(
            "invalid_response",
            `${input.providerName} emitted data after its finish reason`
          );
        }
        for (const event of mapped.events) {
          if (signal.aborted) throw abortReason(signal);
          if (event.type === "usage") {
            if (usageSeen) {
              throw normalizedError(
                "invalid_response",
                `${input.providerName} returned duplicate usage`
              );
            }
            usageSeen = true;
          }
          yield event;
        }
        if (mapped.finishReason !== null) {
          if (finishReason !== null) {
            throw normalizedError(
              "invalid_response",
              `${input.providerName} returned duplicate finish reasons`
            );
          }
          finishReason = mapped.finishReason;
        }
      }
      if (next.done) break;
    }

    if (signal.aborted) throw abortReason(signal);
    if (!sawDone || finishReason === null) {
      throw normalizedError(
        "invalid_response",
        `${input.providerName} ended an incomplete streaming response`
      );
    }
  } catch (error) {
    if (input.signal.aborted) throw abortReason(input.signal);
    failure = timeout.aborted
      ? {
          type: "failure",
          code: "timeout",
          safeMessage: `${input.providerName} streaming request timed out`
        }
      : toFailure(error, input.providerName);
  } finally {
    const cleanupError = await cancelResponseBody(reader, body);
    if (cleanupError && !failure && !input.signal.aborted) {
      failure = {
        type: "failure",
        code: "invalid_response",
        safeMessage: `${input.providerName} streaming response cleanup failed`
      };
    }
  }

  if (input.signal.aborted) throw abortReason(input.signal);
  if (failure) {
    yield failure;
    return;
  }
  if (finishReason === null) {
    yield {
      type: "failure",
      code: "invalid_response",
      safeMessage: `${input.providerName} ended an incomplete streaming response`
    };
    return;
  }
  yield { type: "completed", finishReason };
}

interface ParsedPayload {
  events: StreamingLlmEvent[];
  finishReason: StreamingLlmFinishReason | null;
}

function parsePayload(
  event: EventSourceMessage,
  providerName: string
): ParsedPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data) as unknown;
  } catch (error) {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned malformed streaming JSON`,
      error
    );
  }
  if (!isRecord(payload)) {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned a malformed streaming event`
    );
  }
  if ("error" in payload) {
    throw normalizedError(
      "provider_failed",
      `${providerName} reported a streaming failure`
    );
  }

  const events: StreamingLlmEvent[] = [];
  const usage = parseUsage(payload.usage, providerName);
  if (usage) events.push(usage);
  if (!Array.isArray(payload.choices)) {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned malformed streaming choices`
    );
  }
  if (payload.choices.length > 1) {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned multiple streaming choices`
    );
  }

  let finishReason: StreamingLlmFinishReason | null = null;
  for (const choice of payload.choices) {
    if (!isRecord(choice) || choice.index !== 0) {
      throw normalizedError(
        "invalid_response",
        `${providerName} returned an unsupported streaming choice`
      );
    }
    if (!isRecord(choice.delta)) {
      throw normalizedError(
        "invalid_response",
        `${providerName} returned a malformed streaming delta`
      );
    }
    if (choice.delta.content !== undefined && choice.delta.content !== null) {
      if (typeof choice.delta.content !== "string") {
        throw normalizedError(
          "invalid_response",
          `${providerName} returned malformed streaming text`
        );
      }
      if (choice.delta.content.length > 0) {
        events.push({ type: "text_delta", content: choice.delta.content });
      }
    }
    if (choice.delta.tool_calls !== undefined) {
      events.push(
        ...parseToolCallDeltas(choice.delta.tool_calls, providerName)
      );
    }
    const mappedFinishReason = mapFinishReason(
      choice.finish_reason,
      providerName
    );
    if (mappedFinishReason !== null) {
      if (finishReason !== null) {
        throw normalizedError(
          "invalid_response",
          `${providerName} returned duplicate finish reasons`
        );
      }
      finishReason = mappedFinishReason;
    }
  }
  return { events, finishReason };
}

function parseToolCallDeltas(
  value: unknown,
  providerName: string
): StreamingLlmEvent[] {
  if (!Array.isArray(value)) {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned malformed streaming tool calls`
    );
  }
  return value.map((toolCall) => {
    if (
      !isRecord(toolCall) ||
      typeof toolCall.index !== "number" ||
      !Number.isInteger(toolCall.index)
    ) {
      throw normalizedError(
        "invalid_response",
        `${providerName} returned a malformed streaming tool call`
      );
    }
    const id = optionalString(toolCall.id, "tool-call ID", providerName);
    const fn = toolCall.function;
    if (fn !== undefined && !isRecord(fn)) {
      throw normalizedError(
        "invalid_response",
        `${providerName} returned a malformed streaming tool function`
      );
    }
    const nameDelta = optionalString(fn?.name, "tool name", providerName);
    const argumentsDelta = optionalString(
      fn?.arguments,
      "tool arguments",
      providerName
    );
    if (id === null && nameDelta === null && argumentsDelta === null) {
      throw normalizedError(
        "invalid_response",
        `${providerName} returned an empty streaming tool call`
      );
    }
    return {
      type: "tool_call_delta",
      index: toolCall.index,
      id,
      nameDelta: nameDelta ?? "",
      argumentsDelta: argumentsDelta ?? ""
    } satisfies StreamingLlmEvent;
  });
}

function parseUsage(
  value: unknown,
  providerName: string
): Extract<StreamingLlmEvent, { type: "usage" }> | null {
  if (value === undefined || value === null) return null;
  const inputTokens = isRecord(value) ? value.prompt_tokens : undefined;
  const outputTokens = isRecord(value) ? value.completion_tokens : undefined;
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(inputTokens) ||
    !isNonNegativeInteger(outputTokens)
  ) {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned malformed streaming usage`
    );
  }
  return {
    type: "usage",
    inputTokens,
    outputTokens
  };
}

function mapFinishReason(
  value: unknown,
  providerName: string
): StreamingLlmFinishReason | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned a malformed finish reason`
    );
  }
  switch (value) {
    case "stop":
      return "stop";
    case "tool_calls":
    case "function_call":
      return "tool_call";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    default:
      return "other";
  }
}

async function readWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<T>> {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<ReadableStreamReadResult<T>>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof Error ? error : new Error("Stream read failed")
        );
      }
    );
  });
}

async function cancelResponseBody(
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
  body: ReadableStream<Uint8Array> | null
): Promise<Error | null> {
  if (reader) {
    try {
      await reader.cancel();
      return null;
    } catch (error) {
      return error instanceof Error
        ? error
        : new Error("Streaming response cleanup failed");
    } finally {
      reader.releaseLock();
    }
  }
  try {
    if (body && !body.locked) {
      await body.cancel();
    }
    return null;
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("Streaming response cleanup failed");
  }
}

function toFailure(
  error: unknown,
  providerName: string
): Extract<StreamingLlmEvent, { type: "failure" }> {
  if (error instanceof NormalizedStreamingError) {
    return {
      type: "failure",
      code: error.code,
      safeMessage: error.message
    };
  }
  return {
    type: "failure",
    code: "invalid_response",
    safeMessage: `${providerName} returned an invalid streaming response`
  };
}

class NormalizedStreamingError extends Error {
  public constructor(
    public readonly code: StreamingLlmFailureCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "NormalizedStreamingError";
  }
}

function normalizedError(
  code: StreamingLlmFailureCode,
  message: string,
  cause?: unknown
): NormalizedStreamingError {
  return new NormalizedStreamingError(
    code,
    message,
    cause === undefined ? undefined : { cause }
  );
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

function optionalString(
  value: unknown,
  label: string,
  providerName: string
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw normalizedError(
      "invalid_response",
      `${providerName} returned a malformed ${label}`
    );
  }
  return value;
}

function isEventStream(contentType: string | null): boolean {
  return (
    contentType?.toLowerCase().split(";")[0]?.trim() === "text/event-stream"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
