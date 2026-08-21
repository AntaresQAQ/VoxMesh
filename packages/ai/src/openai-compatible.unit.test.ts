import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleProvider } from "./openai-compatible.js";

const config = {
  baseUrl:
    "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/",
  model: "qwen-plus",
  apiKey: "secret",
  timeoutMs: 5_000,
  maxOutputTokens: 512
};

describe("OpenAiCompatibleProvider", () => {
  it("maps Chat Completions requests and responses", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          choices: [{ message: { content: "你好，我是通义千问。" } }]
        })
    );
    const provider = new OpenAiCompatibleProvider(config, fetcher);

    await expect(
      provider.complete({
        messages: [{ role: "user", content: "你是谁？" }],
        tools: []
      })
    ).resolves.toEqual({
      type: "message",
      content: "你好，我是通义千问。"
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") {
      throw new Error("Expected a JSON request body");
    }
    expect(body).toContain('"model":"qwen-plus"');
    expect(body).toContain('"max_tokens":512');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer secret"
    });
  });

  it("maps compatible tool calls", async () => {
    const provider = new OpenAiCompatibleProvider(
      config,
      vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call-1",
                    function: {
                      name: "mock.get_device_status",
                      arguments: '{"device":"light"}'
                    }
                  }
                ]
              }
            }
          ]
        })
      )
    );

    await expect(
      provider.complete({
        messages: [{ role: "user", content: "检查灯光" }],
        tools: []
      })
    ).resolves.toMatchObject({
      type: "tool_call",
      toolCall: {
        id: "call-1",
        name: "mock.get_device_status"
      }
    });
  });

  it("normalizes compatible provider failures", async () => {
    const provider = new OpenAiCompatibleProvider(
      config,
      vi.fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response("invalid api key", { status: 401 })
      )
    );

    await expect(
      provider.complete({
        messages: [{ role: "user", content: "Hello" }],
        tools: []
      })
    ).rejects.toThrow(
      "OpenAI-compatible request failed (401): invalid api key"
    );
  });

  it("combines provider timeout and caller cancellation signals", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(init?.signal).not.toBe(controller.signal);
        return Response.json({
          choices: [{ message: { content: "Cancelled-safe response" } }]
        });
      }
    );
    const provider = new OpenAiCompatibleProvider(config, fetcher);
    const controller = new AbortController();

    await provider.complete({
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      signal: controller.signal
    });

    controller.abort();
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
