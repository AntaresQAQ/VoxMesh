import { describe, expect, it, vi } from "vitest";

import {
  AzureOpenAiSpeechToTextProvider,
  AzureOpenAiTextToSpeechProvider
} from "./azure-openai-speech.js";

describe("Azure OpenAI speech adapters", () => {
  it("sends multipart audio and maps transcription text", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ text: "你好" })
    );
    const provider = new AzureOpenAiSpeechToTextProvider(
      {
        endpoint: "https://example.openai.azure.com/",
        deployment: "stt deployment",
        apiVersion: "2025-04-01-preview",
        apiKey: "secret",
        language: "zh"
      },
      fetcher
    );

    await expect(
      provider.transcribe(
        {
          data: new Uint8Array([1, 2, 3]),
          mimeType: "audio/webm"
        },
        { signal: controller.signal }
      )
    ).resolves.toEqual({ text: "你好", language: "zh" });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://example.openai.azure.com/openai/deployments/stt%20deployment/audio/transcriptions?api-version=2025-04-01-preview"
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    const requestSignal = fetcher.mock.calls[0]?.[1]?.signal;
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("requests WAV speech with voice instructions", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(new Uint8Array([82, 73, 70, 70]), {
          headers: { "content-type": "audio/wav" }
        })
    );
    const provider = new AzureOpenAiTextToSpeechProvider(
      {
        endpoint: "https://example.openai.azure.com",
        deployment: "tts",
        apiVersion: "2025-03-01-preview",
        apiKey: "secret",
        voice: "coral",
        instructions: "Speak warmly."
      },
      fetcher
    );

    const result = await provider.synthesize("你好");

    expect(result.mimeType).toBe("audio/wav");
    expect(result.data).toEqual(new Uint8Array([82, 73, 70, 70]));
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://example.openai.azure.com/openai/deployments/tts/audio/speech?api-version=2025-03-01-preview"
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain('"voice":"coral"');
  });

  it("normalizes provider failures", async () => {
    const provider = new AzureOpenAiSpeechToTextProvider(
      {
        endpoint: "https://example.openai.azure.com",
        deployment: "stt",
        apiVersion: "2025-04-01-preview",
        apiKey: "secret",
        language: "zh"
      },
      vi.fn(async () => new Response("quota exceeded", { status: 429 }))
    );

    await expect(
      provider.transcribe({
        data: new Uint8Array([1]),
        mimeType: "audio/webm"
      })
    ).rejects.toThrow(
      "Azure OpenAI transcription failed (429): quota exceeded"
    );
  });
});
