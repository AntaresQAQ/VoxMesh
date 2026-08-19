import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleSpeechToTextProvider,
  OpenAiCompatibleTextToSpeechProvider
} from "./openai-compatible-speech.js";

describe("OpenAI-compatible speech adapters", () => {
  it("uses the standard transcription endpoint", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ text: "测试" })
    );
    const provider = new OpenAiCompatibleSpeechToTextProvider(
      {
        baseUrl: "https://provider.example.com/v1/",
        model: "stt-model",
        apiKey: "secret",
        language: "zh"
      },
      fetcher
    );

    await expect(
      provider.transcribe({
        data: new Uint8Array([1]),
        mimeType: "audio/webm"
      })
    ).resolves.toEqual({ text: "测试", language: "zh" });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://provider.example.com/v1/audio/transcriptions"
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer secret"
    });
  });

  it("uses the standard speech endpoint", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "audio/wav" }
        })
    );
    const provider = new OpenAiCompatibleTextToSpeechProvider(
      {
        baseUrl: "https://provider.example.com/v1",
        model: "tts-model",
        apiKey: "secret",
        voice: "voice",
        instructions: "Speak naturally."
      },
      fetcher
    );

    await expect(provider.synthesize("测试")).resolves.toMatchObject({
      mimeType: "audio/wav",
      data: new Uint8Array([1, 2])
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://provider.example.com/v1/audio/speech"
    );
  });
});
