// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render.js";
import type { AudioRecorder } from "./browser-audio.js";
import { VoiceControls } from "./VoiceControls.js";

describe("VoiceControls", () => {
  it("records, submits, renders, and plays a Mock Voice response", async () => {
    const user = userEvent.setup();
    const recorder: AudioRecorder = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => new Blob(["audio"], { type: "audio/webm" })),
      cancel: vi.fn()
    };
    const submitVoice = vi.fn(async () => ({
      conversationId: "conversation-1",
      transcript: "Check the light status",
      response: "The light is on.",
      usedTools: ["mock.get_device_status"],
      audio: {
        base64: "UklGRg==",
        mimeType: "audio/wav",
        sampleRate: 16_000,
        channels: 1
      }
    }));
    const playAudio = vi.fn(async () => undefined);
    renderWithProviders(
      <VoiceControls
        createRecorder={() => recorder}
        submitVoice={submitVoice}
        playAudio={playAudio}
      />
    );

    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(screen.getByRole("status")).toHaveTextContent("Recording");
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    expect(await screen.findByText("Check the light status")).toBeVisible();
    expect(screen.getByText("The light is on.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Play response" }));
    expect(playAudio).toHaveBeenCalledOnce();
  });

  it("announces recording failures", async () => {
    const user = userEvent.setup();
    const recorder: AudioRecorder = {
      start: vi.fn(async () => {
        throw new Error("Microphone permission denied");
      }),
      stop: vi.fn(),
      cancel: vi.fn()
    };
    renderWithProviders(<VoiceControls createRecorder={() => recorder} />);

    await user.click(screen.getByRole("button", { name: "Start recording" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Microphone permission denied"
    );
  });

  it("cancels an active recorder when unmounted", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    const recorder: AudioRecorder = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      cancel
    };
    const view = renderWithProviders(
      <VoiceControls createRecorder={() => recorder} />
    );
    await user.click(screen.getByRole("button", { name: "Start recording" }));

    view.unmount();

    expect(cancel).toHaveBeenCalledOnce();
  });
});
