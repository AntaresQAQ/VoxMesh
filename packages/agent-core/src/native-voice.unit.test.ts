import { describe, expect, it } from "vitest";

import { MockMcpServer } from "./mock.js";
import { MockNativeVoiceProvider } from "./mock-native-voice.js";
import { NativeVoiceRuntime } from "./native-voice.js";

describe("NativeVoiceRuntime", () => {
  it("runs audio, MCP, text, and audio output through one provider", async () => {
    const runtime = new NativeVoiceRuntime(
      new MockNativeVoiceProvider(),
      new MockMcpServer()
    );

    const result = await runtime.run({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm"
    });

    expect(result.transcript).toBe("Check the light status");
    expect(result.response).toContain("Native multimodal model");
    expect(result.usedTools).toEqual(["mock.get_device_status"]);
    expect(result.audio.mimeType).toBe("audio/wav");
  });
});
