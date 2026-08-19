import { describe, expect, it, vi } from "vitest";

import { AzureOpenAiProvider } from "./azure-openai.js";

const config = {
  endpoint: "https://example.openai.azure.com/",
  deployment: "test deployment",
  apiVersion: "2025-01-01-preview",
  apiKey: "secret"
};

describe("AzureOpenAiProvider", () => {
  it("maps a successful text response", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "Hello from Azure" } }]
      })
    );
    const provider = new AzureOpenAiProvider(config, fetcher);

    const result = await provider.complete({
      messages: [{ role: "user", content: "Hello" }],
      tools: []
    });

    expect(result).toEqual({
      type: "message",
      content: "Hello from Azure"
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.openai.azure.com/openai/deployments/test%20deployment/chat/completions?api-version=2025-01-01-preview",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("maps a tool call", async () => {
    const provider = new AzureOpenAiProvider(
      config,
      vi.fn(async () =>
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
        messages: [{ role: "user", content: "Check the light" }],
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

  it("normalizes malformed tool argument JSON", async () => {
    const provider = new AzureOpenAiProvider(
      config,
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call-1",
                    function: {
                      name: "mock.get_device_status",
                      arguments: "{invalid"
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
        messages: [{ role: "user", content: "Check the light" }],
        tools: []
      })
    ).rejects.toThrow("Azure OpenAI returned invalid JSON tool arguments");
  });
});
