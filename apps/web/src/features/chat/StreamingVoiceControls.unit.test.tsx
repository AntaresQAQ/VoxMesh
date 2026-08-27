// @vitest-environment jsdom

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render.js";
import { StreamingVoiceControls } from "./StreamingVoiceControls.js";
import type {
  BrowserVoiceStreamCallbacks,
  BrowserVoiceStreamSession,
  BrowserVoiceStreamSessionOptions
} from "./voice-stream-client.js";

afterEach(() => {
  localStorage.clear();
});

describe("StreamingVoiceControls", () => {
  it("starts, renders incremental state, finishes, and cancels", async () => {
    const user = userEvent.setup();
    let callbacks: BrowserVoiceStreamCallbacks | undefined;
    const finishInput = vi.fn(async () => undefined);
    const cancel = vi.fn();
    const session: BrowserVoiceStreamSession = {
      start: vi.fn(async () => undefined),
      finishInput,
      cancel
    };
    const createSession = vi.fn((options: BrowserVoiceStreamSessionOptions) => {
      callbacks = options.callbacks;
      return session;
    });
    renderWithProviders(
      <StreamingVoiceControls supported createSession={createSession} />
    );

    expect(screen.getByLabelText("Allow tools for this session")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Start streaming" }));
    expect(
      screen.getByRole("button", { name: "Start streaming" })
    ).toBeDisabled();
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ allowTools: true })
    );
    act(() => {
      callbacks?.onState("capturing");
      callbacks?.onLevel(48);
      callbacks?.onPartialTranscript("Check");
      callbacks?.onAssistantText("The light");
      callbacks?.onTool("mock.get_device_status");
      callbacks?.onPressure("high");
    });

    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "48");
    expect(screen.getByText("Check")).toBeVisible();
    expect(screen.getByText("The light")).toBeVisible();
    expect(screen.getByText(/mock.get_device_status/)).toBeVisible();
    expect(screen.getByText(/temporarily backpressured/)).toBeVisible();
    expect(
      screen.getByLabelText("Allow tools for this session")
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Finish input" }));
    expect(finishInput).toHaveBeenCalledOnce();

    act(() => callbacks?.onState("processing"));
    await user.click(screen.getByRole("button", { name: "Cancel streaming" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.getByText("Streaming voice cancelled.")).toBeVisible();
  });

  it("keeps buffered voice available when streaming APIs are unsupported", () => {
    renderWithProviders(<StreamingVoiceControls supported={false} />);

    expect(
      screen.getByRole("button", { name: "Start streaming" })
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Buffered voice remains available"
    );
  });

  it("disables tools for the next session and cleans up on unmount", async () => {
    const user = userEvent.setup();
    let callbacks: BrowserVoiceStreamCallbacks | undefined;
    const cancel = vi.fn();
    const session: BrowserVoiceStreamSession = {
      start: vi.fn(async () => undefined),
      finishInput: vi.fn(async () => undefined),
      cancel
    };
    const createSession = vi.fn((options: BrowserVoiceStreamSessionOptions) => {
      callbacks = options.callbacks;
      return session;
    });
    const view = renderWithProviders(
      <StreamingVoiceControls supported createSession={createSession} />
    );
    await user.click(screen.getByLabelText("Allow tools for this session"));
    await user.click(screen.getByRole("button", { name: "Start streaming" }));

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ allowTools: false })
    );
    act(() => callbacks?.onState("capturing"));
    view.unmount();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cleans up the session when finishing input fails", async () => {
    const user = userEvent.setup();
    let callbacks: BrowserVoiceStreamCallbacks | undefined;
    const cancel = vi.fn();
    const session: BrowserVoiceStreamSession = {
      start: vi.fn(async () => undefined),
      finishInput: vi.fn(async () => {
        throw new Error("Input drain failed");
      }),
      cancel
    };
    renderWithProviders(
      <StreamingVoiceControls
        supported
        createSession={(options) => {
          callbacks = options.callbacks;
          return session;
        }}
      />
    );
    await user.click(screen.getByRole("button", { name: "Start streaming" }));
    act(() => callbacks?.onState("capturing"));

    await user.click(screen.getByRole("button", { name: "Finish input" }));

    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Input drain failed");
    expect(
      screen.getByRole("button", { name: "Start streaming" })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Cancel streaming" })
    ).toBeDisabled();
  });

  it("renders start failures and unsupported state in Simplified Chinese", async () => {
    localStorage.setItem("voxmesh.locale", "zh-CN");
    const user = userEvent.setup();
    const cancel = vi.fn();
    const session: BrowserVoiceStreamSession = {
      start: vi.fn(async () => {
        throw new Error("Microphone permission was denied");
      }),
      finishInput: vi.fn(async () => undefined),
      cancel
    };
    const view = renderWithProviders(
      <StreamingVoiceControls supported createSession={() => session} />
    );

    await user.click(screen.getByRole("button", { name: "开始流式语音" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Microphone permission was denied"
    );
    expect(cancel).toHaveBeenCalledOnce();

    view.unmount();
    renderWithProviders(<StreamingVoiceControls supported={false} />);
    expect(screen.getByRole("button", { name: "开始流式语音" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("缓冲语音仍然可用");
  });
});
