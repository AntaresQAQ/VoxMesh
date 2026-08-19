import { MockTextToSpeechProvider, type AudioData } from "@voxmesh/audio";
import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

import type {
  NativeVoiceProvider,
  NativeVoiceProviderResponse
} from "./native-voice.js";

/**
 * Simulates one multimodal model that accepts audio, calls tools, and returns
 * text plus audio without exposing separate STT/TTS stages.
 */
export class MockNativeVoiceProvider implements NativeVoiceProvider {
  private readonly tts = new MockTextToSpeechProvider();

  public async complete(input: {
    audio?: AudioData;
    messages: AgentMessage[];
    tools: ToolDefinition[];
  }): Promise<NativeVoiceProviderResponse> {
    const toolResult = [...input.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (!toolResult) {
      if (!input.audio || input.audio.data.byteLength === 0) {
        throw new Error("Native multimodal audio input must not be empty");
      }
      return {
        type: "tool_call",
        transcript: "Check the light status",
        toolCall: {
          id: "mock-native-tool-call",
          name: "mock.get_device_status",
          arguments: { device: "living-room-light" }
        }
      };
    }
    const text = "Native multimodal model reports living-room-light is on.";
    return {
      type: "response",
      transcript: "Check the light status",
      text,
      audio: await this.tts.synthesize(text)
    };
  }
}
