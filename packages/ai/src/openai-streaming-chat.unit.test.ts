import { describe, expect, it, vi } from "vitest";

import {
  MockMcpServer,
  StreamingAgentRuntime,
  type AgentRunResult,
  type StreamingAgentEvent,
  type StreamingLlmEvent
} from "@voxmesh/agent-core";

import { AzureOpenAiStreamingProvider } from "./azure-openai.js";
import { OpenAiCompatibleStreamingProvider } from "./openai-compatible.js";

const compatibleConfig = {
  baseUrl:
    "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/",
  model: "qwen-plus",
  apiKey: "test-api-key",
  timeoutMs: 5_000,
  maxOutputTokens: 512
};

describe("OpenAI Chat Completions streaming adapters", () => {
  it("parses arbitrary UTF-8 chunks, multiline SSE, usage, and completion", async () => {
    const cancel = vi.fn();
    const response = sseResponse(
      [
        jsonEvent({
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null
            }
          ]
        }),
        jsonEvent({
          choices: [
            {
              index: 0,
              delta: { content: "你" },
              finish_reason: null
            }
          ]
        }),
        [
          'data: {"choices":[',
          'data: {"index":0,"delta":{"content":"好"},"finish_reason":"stop"}',
          'data: ],"usage":null}',
          "",
          ""
        ].join("\n"),
        jsonEvent({
          choices: [],
          usage: { prompt_tokens: 8, completion_tokens: 2 }
        }),
        "data: [DONE]\n\n"
      ].join(""),
      [1, 2, 3, 5, 8, 13],
      cancel
    );
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => response
    );
    const provider = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      fetcher
    );

    const events = await collect(
      provider.stream({
        messages: [{ role: "user", content: "你好" }],
        tools: [],
        signal: new AbortController().signal
      })
    );

    expect(events).toEqual([
      { type: "text_delta", content: "你" },
      { type: "text_delta", content: "好" },
      { type: "usage", inputTokens: 8, outputTokens: 2 },
      { type: "completed", finishReason: "stop" }
    ]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
    expect(request?.headers).toMatchObject({
      authorization: ["Bearer", compatibleConfig.apiKey].join(" "),
      "content-type": "application/json"
    });
    expect(parseRequestBody(request)).toMatchObject({
      model: "qwen-plus",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 512
    });
  });

  it("maps fragmented compatible tool calls without assembling provider data", async () => {
    const response = sseResponse(
      [
        jsonEvent({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    function: {
                      name: "mock.get_",
                      arguments: '{"device":"living-'
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        }),
        jsonEvent({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: "device_status",
                      arguments: 'room-light"}'
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        }),
        "data: [DONE]\n\n"
      ].join("")
    );
    const provider = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () => response)
    );

    await expect(
      collect(
        provider.stream({
          messages: [{ role: "user", content: "Check the light" }],
          tools: [
            {
              name: "mock.get_device_status",
              description: "Get device status",
              inputSchema: {
                type: "object",
                properties: { device: { type: "string" } }
              }
            }
          ],
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      {
        type: "tool_call_delta",
        index: 0,
        id: "call-1",
        nameDelta: "mock.get_",
        argumentsDelta: '{"device":"living-'
      },
      {
        type: "tool_call_delta",
        index: 0,
        id: null,
        nameDelta: "device_status",
        argumentsDelta: 'room-light"}'
      },
      { type: "completed", finishReason: "tool_call" }
    ]);
  });

  it("assembles compatible fragments through Agent Core like the Mock provider", async () => {
    const responses = [
      sseResponse(
        [
          jsonEvent({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: {
                        name: "mock.get_",
                        arguments: '{"device":"living-'
                      }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          }),
          jsonEvent({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        name: "device_status",
                        arguments: 'room-light"}'
                      }
                    }
                  ]
                },
                finish_reason: "tool_calls"
              }
            ]
          }),
          "data: [DONE]\n\n"
        ].join("")
      ),
      sseResponse(
        [
          jsonEvent({
            choices: [
              {
                index: 0,
                delta: { content: "The light is on." },
                finish_reason: "stop"
              }
            ]
          }),
          "data: [DONE]\n\n"
        ].join("")
      )
    ];
    const provider = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () => {
        const response = responses.shift();
        if (!response) throw new Error("No fixture response remains");
        return response;
      })
    );
    const runtime = new StreamingAgentRuntime(provider, new MockMcpServer());

    const run = await collectRun(
      runtime.run("Check the light status", {
        toolMode: "enabled",
        signal: new AbortController().signal
      })
    );

    expect(run.result.response).toBe("The light is on.");
    expect(run.result.usedTools).toEqual(["mock.get_device_status"]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call_delta",
          toolName: "mock.get_device_status",
          complete: true
        }),
        expect.objectContaining({
          type: "tool_finished",
          toolName: "mock.get_device_status",
          success: true
        })
      ])
    );
  });

  it("maps Azure URL, authentication, limits, and content filtering", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        sseResponse(
          `${jsonEvent({
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "content_filter"
              }
            ]
          })}data: [DONE]\n\n`
        )
    );
    const provider = new AzureOpenAiStreamingProvider(
      {
        endpoint: "https://example.openai.azure.com/",
        deployment: "test deployment",
        apiVersion: "2025-01-01-preview",
        apiKey: "test-api-key",
        timeoutMs: 4_000,
        maxOutputTokens: 256
      },
      fetcher
    );

    await expect(
      collect(
        provider.stream({
          messages: [{ role: "user", content: "Hello" }],
          tools: [],
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([{ type: "completed", finishReason: "content_filter" }]);
    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://example.openai.azure.com/openai/deployments/test%20deployment/chat/completions?api-version=2025-01-01-preview"
    );
    expect(request?.headers).toMatchObject({
      "api-key": "test-api-key",
      "content-type": "application/json"
    });
    expect(parseRequestBody(request)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 256
    });
    expect(parseRequestBody(request)).not.toHaveProperty("model");
  });

  it("returns safe failures without exposing provider payloads", async () => {
    const leakedPayload = "credential=provider-secret";
    const provider = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () => new Response(leakedPayload, { status: 401 }))
    );

    const events = await collect(
      provider.stream({
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
        signal: new AbortController().signal
      })
    );

    expect(events).toEqual([
      {
        type: "failure",
        code: "provider_failed",
        safeMessage: "OpenAI-compatible provider streaming request failed (401)"
      }
    ]);
    expect(JSON.stringify(events)).not.toContain(leakedPayload);
  });

  it("normalizes malformed and incomplete streams", async () => {
    const malformed = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () => sseResponse("data: {invalid}\n\ndata: [DONE]\n\n"))
    );
    const incomplete = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () =>
        sseResponse(
          jsonEvent({
            choices: [
              {
                index: 0,
                delta: { content: "partial" },
                finish_reason: null
              }
            ]
          }),
          undefined,
          undefined,
          true
        )
      )
    );

    await expect(
      collect(
        malformed.stream({
          messages: [],
          tools: [],
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      {
        type: "failure",
        code: "invalid_response",
        safeMessage:
          "OpenAI-compatible provider returned malformed streaming JSON"
      }
    ]);
    await expect(
      collect(
        incomplete.stream({
          messages: [],
          tools: [],
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: "text_delta", content: "partial" },
      {
        type: "failure",
        code: "invalid_response",
        safeMessage:
          "OpenAI-compatible provider ended an incomplete streaming response"
      }
    ]);
  });

  it("bounds incomplete SSE events and provider timeouts", async () => {
    const oversized = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () =>
        sseResponse(`data: ${"x".repeat(129 * 1024)}`, [257], undefined, true)
      )
    );
    const cancel = vi.fn();
    const timedOut = new OpenAiCompatibleStreamingProvider(
      { ...compatibleConfig, timeoutMs: 5 },
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel
            }),
            {
              headers: { "content-type": "text/event-stream" }
            }
          )
      )
    );

    await expect(
      collect(
        oversized.stream({
          messages: [],
          tools: [],
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      {
        type: "failure",
        code: "invalid_response",
        safeMessage:
          "OpenAI-compatible provider returned malformed event-stream data"
      }
    ]);
    await expect(
      collect(
        timedOut.stream({
          messages: [],
          tools: [],
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      {
        type: "failure",
        code: "timeout",
        safeMessage: "OpenAI-compatible provider streaming request timed out"
      }
    ]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops queued SSE delivery immediately after caller cancellation", async () => {
    const cancel = vi.fn();
    const provider = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () =>
        sseResponse(
          [
            jsonEvent({
              choices: [
                {
                  index: 0,
                  delta: { content: "first" },
                  finish_reason: null
                }
              ]
            }),
            jsonEvent({
              choices: [
                {
                  index: 0,
                  delta: { content: "second" },
                  finish_reason: "stop"
                }
              ]
            }),
            "data: [DONE]\n\n"
          ].join(""),
          undefined,
          cancel
        )
      )
    );
    const controller = new AbortController();
    const stream = provider.stream({
      messages: [],
      tools: [],
      signal: controller.signal
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: { type: "text_delta", content: "first" },
      done: false
    });
    controller.abort();

    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a complete SSE event that exceeds the explicit event bound", async () => {
    const provider = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () =>
        sseResponse(
          [
            jsonEvent({
              choices: [
                {
                  index: 0,
                  delta: { content: "x".repeat(129 * 1024) },
                  finish_reason: "stop"
                }
              ]
            }),
            "data: [DONE]\n\n"
          ].join("")
        )
      )
    );

    await expect(
      collect(
        provider.stream({
          messages: [],
          tools: [],
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      {
        type: "failure",
        code: "invalid_response",
        safeMessage:
          "OpenAI-compatible provider returned malformed event-stream data"
      }
    ]);
  });

  it("cancels the provider response body when the caller aborts", async () => {
    const cancel = vi.fn();
    const provider = new OpenAiCompatibleStreamingProvider(
      compatibleConfig,
      vi.fn(async () =>
        sseResponse(
          jsonEvent({
            choices: [
              {
                index: 0,
                delta: { content: "partial" },
                finish_reason: null
              }
            ]
          }),
          undefined,
          cancel
        )
      )
    );
    const controller = new AbortController();
    const stream = provider.stream({
      messages: [],
      tools: [],
      signal: controller.signal
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: { type: "text_delta", content: "partial" },
      done: false
    });
    controller.abort();

    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

async function collect(
  events: AsyncIterable<StreamingLlmEvent>
): Promise<StreamingLlmEvent[]> {
  const collected: StreamingLlmEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function collectRun(
  generator: AsyncGenerator<StreamingAgentEvent, AgentRunResult>
): Promise<{ events: StreamingAgentEvent[]; result: AgentRunResult }> {
  const events: StreamingAgentEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

function jsonEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseResponse(
  content: string,
  chunkSizes: number[] = [content.length],
  cancel = vi.fn(),
  close = false
): Response {
  const bytes = new TextEncoder().encode(content);
  let offset = 0;
  let chunkIndex = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          if (close) controller.close();
          return;
        }
        const requested = chunkSizes[chunkIndex % chunkSizes.length] ?? 1;
        const end = Math.min(bytes.length, offset + Math.max(1, requested));
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
        chunkIndex += 1;
        if (close && offset >= bytes.length) controller.close();
      },
      cancel
    }),
    {
      headers: { "content-type": "text/event-stream; charset=utf-8" }
    }
  );
}

function parseRequestBody(request: RequestInit | undefined): unknown {
  if (typeof request?.body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  return JSON.parse(request.body) as unknown;
}
