import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  expectNoHorizontalOverflow,
  expectVisibleFocus,
  installEventStreamFixture,
  routeJson,
  sendEventStreamGap,
  sendEventStreamRestart
} from "./phase3-fixtures.js";

const password = "correct horse battery staple";
const replacementPassword = "replacement horse battery staple";

test("completes setup, tool-assisted chat, inspection, and logout", async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const failure = (
            globalThis as typeof globalThis & {
              __voxmeshMicrophoneFailure?: string;
            }
          ).__voxmeshMicrophoneFailure;
          if (failure) throw new DOMException(failure, "NotAllowedError");
          return {
            getTracks: () => [{ stop: () => undefined }]
          };
        }
      }
    });
    class FakeMediaRecorder extends EventTarget {
      public state: RecordingState = "inactive";
      public readonly mimeType = "audio/webm";

      public start(): void {
        this.state = "recording";
      }

      public stop(): void {
        const data = new Event("dataavailable");
        Object.defineProperty(data, "data", {
          value: new Blob(["mock audio"], { type: this.mimeType })
        });
        this.dispatchEvent(data);
        this.state = "inactive";
        this.dispatchEvent(new Event("stop"));
      }
    }
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder
    });
    class FakeAudioContext {
      public async resume(): Promise<void> {
        return undefined;
      }

      public createMediaStreamSource(): {
        connect: () => void;
        disconnect: () => void;
      } {
        return {
          connect: () => undefined,
          disconnect: () => undefined
        };
      }

      public createAnalyser(): {
        fftSize: number;
        smoothingTimeConstant: number;
        getFloatTimeDomainData: (samples: Float32Array) => void;
        disconnect: () => void;
      } {
        return {
          fftSize: 1024,
          smoothingTimeConstant: 0,
          getFloatTimeDomainData: (samples) => samples.fill(0.1),
          disconnect: () => undefined
        };
      }

      public async decodeAudioData(): Promise<{
        numberOfChannels: number;
        sampleRate: number;
        length: number;
        getChannelData: () => Float32Array;
      }> {
        return {
          numberOfChannels: 1,
          sampleRate: 16_000,
          length: 4,
          getChannelData: () => new Float32Array([0, 0.25, -0.25, 0])
        };
      }

      public async close(): Promise<void> {
        return undefined;
      }
    }
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: FakeAudioContext
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await expect(
    page.getByRole("heading", { name: "Create administrator password" })
  ).toBeVisible();
  await expectAccessible(page, "English dark setup");
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await expect(
    page.getByRole("heading", { name: "创建管理员密码" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "创建管理员密码" })
  ).toBeVisible();
  await page.getByLabel("语言", { exact: true }).selectOption("en");

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Complete setup" }).click();

  await expect(
    page.getByRole("heading", { name: "Administrator sign in" })
  ).toBeVisible();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const dashboardHeading = page.getByRole("heading", { name: "Dashboard" });
  await expect(dashboardHeading).toBeVisible();
  await expect(dashboardHeading).toBeFocused();
  await expect(page.getByText("mock.get_device_status")).toBeVisible();
  await expect(page.getByText("Default Composed Voice")).toBeVisible();
  await expect(page.getByText("Chat · Mock Chat")).toBeVisible();
  await expect(page.getByText("STT · Mock STT")).toBeVisible();
  await expect(page.getByText("TTS · Mock TTS")).toBeVisible();
  await expect(page.getByText("Required capabilities verified")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Device and physical audio" })
  ).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(6);
  await expect(page.getByText("Adapter is not configured")).toHaveCount(6);
  await expectAccessible(page, "English dark dashboard");
  const dashboardFailurePage = await page.context().newPage();
  await dashboardFailurePage.emulateMedia({ colorScheme: "dark" });
  await routeJson(
    dashboardFailurePage,
    "**/api/dashboard",
    {
      error: {
        code: "DASHBOARD_UNAVAILABLE",
        message: "Dashboard summary unavailable"
      }
    },
    503
  );
  await routeJson(dashboardFailurePage, "**/api/device", {
    device: {
      status: "degraded",
      displayName: "Fixture host",
      detailCode: "thermal-throttling",
      observedAt: "2026-08-21T00:00:00.000Z"
    },
    audio: {
      input: {
        status: "ready",
        displayName: "Fixture microphone",
        detailCode: null,
        observedAt: "2026-08-21T00:00:00.000Z"
      },
      output: {
        status: "failed",
        displayName: "Fixture speaker",
        detailCode: "playback-unavailable",
        observedAt: null
      }
    },
    system: {
      cpuUsage: {
        status: "stale",
        value: 42,
        unit: "percent",
        detailCode: "stale-sample",
        observedAt: "2026-08-21T00:00:00.000Z"
      },
      memoryUsage: {
        status: "ready",
        value: 134217728,
        unit: "bytes",
        detailCode: null,
        observedAt: "2026-08-21T00:00:00.000Z"
      },
      temperature: {
        status: "unavailable",
        value: null,
        unit: "celsius",
        detailCode: "sensor-unavailable",
        observedAt: null
      }
    }
  });
  await dashboardFailurePage.goto("/dashboard");
  await expect(dashboardFailurePage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark"
  );
  await expect(dashboardFailurePage.getByRole("alert")).toContainText(
    "Dashboard summary unavailable"
  );
  await expect(dashboardFailurePage.getByText("Fixture host")).toBeVisible();
  await expect(
    dashboardFailurePage.getByText("Ready", { exact: true })
  ).toHaveCount(2);
  await expect(dashboardFailurePage.getByText("Degraded")).toBeVisible();
  await expect(
    dashboardFailurePage.getByText("Stale", { exact: true })
  ).toBeVisible();
  await expect(
    dashboardFailurePage.getByText("Failed", { exact: true })
  ).toBeVisible();
  await expect(
    dashboardFailurePage.getByText("Unavailable", { exact: true })
  ).toBeVisible();
  await expectAccessible(
    dashboardFailurePage,
    "English dark independent Dashboard failure"
  );
  await dashboardFailurePage.close();
  await page.keyboard.press("Tab");
  const manageRouting = page.getByRole("link", { name: "Manage routing" });
  await expectVisibleFocus(manageRouting);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\?section=providers/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeFocused();

  await page.getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "Chat" })).toBeFocused();
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __voxmeshMicrophoneFailure?: string;
      }
    ).__voxmeshMicrophoneFailure = "Microphone permission denied";
  });
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone permission denied"
  );
  await page.evaluate(() => {
    delete (
      globalThis as typeof globalThis & {
        __voxmeshMicrophoneFailure?: string;
      }
    ).__voxmeshMicrophoneFailure;
  });

  const failedConversationId = "failed-conversation";
  let failedRunId = "";
  const chatFailurePage = await page.context().newPage();
  await chatFailurePage.emulateMedia({ colorScheme: "dark" });
  await chatFailurePage.route("**/api/chat", async (route) => {
    failedRunId = (route.request().postDataJSON() as { runId: string }).runId;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Mock provider unavailable"
        }
      })
    });
  });
  await chatFailurePage.route("**/api/chat/runs/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: failedRunId,
        conversationId: failedConversationId,
        kind: "chat",
        status: "failed",
        correlationId: "77777777-7777-4777-8777-777777777777",
        inputMessageId: "failed-message",
        retryOfRunId: null,
        startedAt: "2026-08-21T00:00:00.000Z",
        completedAt: "2026-08-21T00:00:01.000Z",
        durationMs: 1000,
        errorCode: "PROVIDER_UNAVAILABLE"
      })
    });
  });
  await chatFailurePage.route(
    `**/api/conversations/${failedConversationId}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: failedConversationId,
          title: "Failed request",
          messageCount: 1,
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:01.000Z",
          messages: [
            {
              id: "failed-message",
              role: "user",
              runId: failedRunId,
              content: "Fail this request",
              createdAt: "2026-08-21T00:00:00.000Z"
            }
          ],
          events: [],
          runs: [
            {
              id: failedRunId,
              conversationId: failedConversationId,
              kind: "chat",
              status: "failed",
              correlationId: "77777777-7777-4777-8777-777777777777",
              inputMessageId: "failed-message",
              retryOfRunId: null,
              startedAt: "2026-08-21T00:00:00.000Z",
              completedAt: "2026-08-21T00:00:01.000Z",
              durationMs: 1000,
              errorCode: "PROVIDER_UNAVAILABLE"
            }
          ]
        })
      })
  );
  await chatFailurePage.goto("/chat");
  await expect(chatFailurePage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark"
  );
  await chatFailurePage.getByLabel("Message").fill("Fail this request");
  await chatFailurePage.getByRole("button", { name: "Send" }).click();
  await expect(chatFailurePage.getByRole("alert")).toContainText(
    "Mock provider unavailable"
  );
  await expect(chatFailurePage).toHaveURL(
    new RegExp(`conversationId=${failedConversationId}`)
  );
  await expect(
    chatFailurePage.getByRole("button", { name: "Retry" })
  ).toBeVisible();
  await chatFailurePage.reload();
  await expect(chatFailurePage.getByText("Fail this request")).toBeVisible();
  await expect(
    chatFailurePage.getByRole("button", { name: "Retry" })
  ).toBeVisible();
  await expectAccessible(chatFailurePage, "English dark failed Chat recovery");
  await chatFailurePage.close();
  await page.evaluate(() => {
    const originalFetch = globalThis.fetch;
    Object.assign(globalThis, {
      __restoreChatFetch: () => {
        globalThis.fetch = originalFetch;
      }
    });
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === "/api/chat") {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }
      if (/^\/api\/chat\/runs\/[^/]+\/cancel$/.test(url)) {
        const runId = url.split("/").at(-2);
        return Response.json({
          id: runId,
          conversationId: "cancelled-conversation",
          kind: "chat",
          status: "cancelled",
          correlationId: "22222222-2222-4222-8222-222222222222",
          inputMessageId: "cancelled-message",
          retryOfRunId: null,
          startedAt: "2026-08-19T00:00:00.000Z",
          completedAt: "2026-08-19T00:00:01.000Z",
          durationMs: 1000,
          errorCode: "RUN_CANCELLED"
        });
      }
      return originalFetch(input, init);
    };
  });
  await page.getByLabel("Message").fill("Cancel this request");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Conversation run in progress...")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Conversation run cancelled.")).toBeVisible();
  await expectAccessible(page, "English dark cancelled Chat run");
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __restoreChatFetch?: () => void;
      }
    ).__restoreChatFetch?.();
  });

  let retryCompleted = false;
  await page.route("**/api/conversations/retry-conversation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "retry-conversation",
        title: "Retry conversation",
        messageCount: retryCompleted ? 2 : 1,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:01.000Z",
        messages: [
          {
            id: "retry-message",
            role: "user",
            runId: "33333333-3333-4333-8333-333333333333",
            content: "Retry this request",
            createdAt: "2026-08-19T00:00:00.000Z"
          },
          ...(retryCompleted
            ? [
                {
                  id: "retry-answer",
                  role: "assistant",
                  runId: "44444444-4444-4444-8444-444444444444",
                  content: "Retry completed",
                  createdAt: "2026-08-19T00:00:01.000Z"
                }
              ]
            : [])
        ],
        events: [],
        runs: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            conversationId: "retry-conversation",
            kind: "chat",
            status: "cancelled",
            correlationId: "55555555-5555-4555-8555-555555555555",
            inputMessageId: "retry-message",
            retryOfRunId: null,
            startedAt: "2026-08-19T00:00:00.000Z",
            completedAt: "2026-08-19T00:00:01.000Z",
            durationMs: 1000,
            errorCode: "RUN_CANCELLED"
          },
          ...(retryCompleted
            ? [
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  conversationId: "retry-conversation",
                  kind: "chat",
                  status: "completed",
                  correlationId: "66666666-6666-4666-8666-666666666666",
                  inputMessageId: "retry-message",
                  retryOfRunId: "33333333-3333-4333-8333-333333333333",
                  startedAt: "2026-08-19T00:00:01.000Z",
                  completedAt: "2026-08-19T00:00:02.000Z",
                  durationMs: 1000,
                  errorCode: null
                }
              ]
            : [])
        ]
      })
    });
  });
  await page.route("**/api/chat/runs/*/retry", async (route) => {
    retryCompleted = true;
    const request = route.request().postDataJSON() as { runId: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runId: request.runId,
        conversationId: "retry-conversation",
        response: "Retry completed",
        usedTools: []
      })
    });
  });
  await page.goto("/chat?conversationId=retry-conversation");
  await expect(page.getByText("Retry this request")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Retry completed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expectAccessible(page, "English dark retried Chat run");
  await page.unroute("**/api/conversations/retry-conversation");
  await page.unroute("**/api/chat/runs/*/retry");
  await page.goto("/chat");

  const messageInput = page.getByLabel("Message");
  await messageInput.fill("Check the light status");
  await messageInput.focus();
  await page.keyboard.press("Tab");
  const sendButton = page.getByRole("button", { name: "Send" });
  await expectVisibleFocus(sendButton);
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Mock tool reports living-room-light is on.")
  ).toBeVisible();
  await expect(page).toHaveURL(/\/chat\?conversationId=[^&]+$/);
  await expect(
    page.getByRole("heading", { name: "Conversation transcript" })
  ).toBeVisible();
  await page.getByLabel("Message").fill("Continue this conversation");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Mock assistant received: Continue this conversation")
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Mock assistant received: Continue this conversation")
  ).toBeVisible();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("status")).toContainText("Recording");
  const voiceRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/voice"
  );
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect
    .poll(async () => (await voiceRequest).headers()["content-type"])
    .toBe("audio/wav");
  await expect(
    page.locator(".voice-result").getByText("Check the light status")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play response" })
  ).toBeEnabled();
  await expectAccessible(page, "English dark Mock Voice chat");

  await page.getByRole("link", { name: "Conversations" }).click();
  await page
    .getByRole("link", { name: /Check the light status/ })
    .last()
    .click();
  await expect(page).toHaveURL(/\/conversations\/[^/]+$/);
  await expect(page.getByText("living-room-light is on.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Processing pipeline" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Conversation runs" })
  ).toBeVisible();
  await expect(page.getByText("Correlation ID").first()).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/conversations$/);
  await page
    .getByRole("link", { name: /Check the light status/ })
    .first()
    .click();
  await expect(page.getByText("Text to speech")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/conversations$/);
  await page.goForward();
  await expect(page.getByText("living-room-light is on.")).toBeVisible();

  await page.evaluate(async () => {
    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: crypto.randomUUID(),
            message: `Overflow test ${index}`
          })
        })
      )
    );
    if (responses.some((response) => !response.ok)) {
      throw new Error("Failed to create overflow test data");
    }
  });
  await page.getByRole("link", { name: "Logs" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Live updates connected"
  );
  await expect(page.getByText("Calling MCP tool").first()).toBeVisible();
  const toolLogCount = await page.getByText("Calling MCP tool").count();
  await page.evaluate(async () => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: crypto.randomUUID(),
        message: "Check live device status"
      })
    });
    if (!response.ok) throw new Error("Failed to create a live log event");
  });
  await expect
    .poll(() => page.getByText("Calling MCP tool").count())
    .toBeGreaterThan(toolLogCount);
  await page.getByLabel("Category").selectOption("MCP");
  await page.getByLabel("Level").selectOption("INFO");
  await expect(page).toHaveURL(/category=MCP/);
  await expect(page).toHaveURL(/level=INFO/);
  await page.reload();
  await expect(page.getByLabel("Category")).toHaveValue("MCP");
  await expect(page.getByLabel("Level")).toHaveValue("INFO");
  await expectAccessible(page, "English dark live logs");
  const recoveryPage = await page.context().newPage();
  await recoveryPage.emulateMedia({ colorScheme: "dark" });
  await installEventStreamFixture(recoveryPage);
  await recoveryPage.goto("/logs");
  await expect(recoveryPage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark"
  );
  await expect(recoveryPage.getByRole("status")).toContainText(
    "Live updates connected"
  );
  await sendEventStreamGap(recoveryPage);
  await expect(
    recoveryPage.getByText(/Some events are no longer available for replay/)
  ).toBeVisible();
  await recoveryPage.getByRole("button", { name: "Refresh snapshot" }).click();
  await expect(
    recoveryPage.getByText(/Some events are no longer available for replay/)
  ).toHaveCount(0);
  await sendEventStreamRestart(recoveryPage);
  await expect(
    recoveryPage.getByText(/The server event stream restarted/)
  ).toBeVisible();
  await recoveryPage.getByRole("button", { name: "Refresh snapshot" }).click();
  await expect(
    recoveryPage.getByText(/The server event stream restarted/)
  ).toHaveCount(0);
  await expect(recoveryPage.getByRole("status")).toContainText(
    "Live updates connected"
  );
  await expectAccessible(
    recoveryPage,
    "English dark event gap and restart recovery"
  );
  await recoveryPage.close();
  await page.getByLabel("Category").selectOption("ALL");
  await page.getByLabel("Level").selectOption("ALL");
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector("aside");
    const main = document.querySelector("main");
    if (!sidebar || !main) {
      throw new Error("Console layout elements were not found");
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    return {
      sidebarHeight: sidebarRect.height,
      sidebarBottom: sidebarRect.bottom,
      viewportHeight: window.innerHeight,
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight
    };
  });
  expect(layout.mainScrollHeight).toBeGreaterThan(layout.mainClientHeight);
  expect(layout.sidebarHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.sidebarBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "显示语言" })).toBeVisible();
  await expectAccessible(page, "Simplified Chinese dark settings");
  await page.getByRole("link", { name: "仪表盘" }).click();
  await expect(page.getByRole("heading", { name: "仪表盘" })).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "设备与物理音频" })
  ).toBeVisible();
  await expectAccessible(page, "Simplified Chinese dark dashboard");
  await page.getByRole("link", { name: "设置" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("语言", { exact: true }).selectOption("en");

  await page.getByLabel("Theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectAccessible(page, "English light settings");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expectAccessible(page, "English light dashboard");
  await page.setViewportSize({ width: 640, height: 360 });
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page, "English light Dashboard at 200% equivalent");
  await page.getByRole("link", { name: "Settings" }).click();
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 360, height: 667 });
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page, "English light narrow Settings");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("Theme").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("link", { name: "AI Providers" }).click();
  await expect(page).toHaveURL(/section=providers/);
  await expect(
    page.getByRole("heading", { name: "Runtime routing" })
  ).toBeVisible();
  await expect(page.getByText("Default Composed Voice").first()).toBeVisible();
  const routingManagers = page.locator("details.routing-management");
  const connectionManager = routingManagers.nth(0);
  await connectionManager.locator("summary").click();
  await expect(
    page.getByText("Chat · Mock", { exact: true }).first()
  ).toBeVisible();
  const referencedConnection = connectionManager
    .getByText("Chat · Mock", { exact: true })
    .locator("..");
  await expect(
    referencedConnection.getByRole("button", { name: "Delete" })
  ).toBeDisabled();
  await expect(referencedConnection).toContainText("Used by models:");
  await connectionManager
    .getByRole("button", { name: "Add connection" })
    .click();
  await connectionManager.getByLabel("Provider").selectOption("mock");
  await connectionManager.getByLabel("Display name").fill("E2E Mock");
  await connectionManager.getByRole("button", { name: "Create" }).click();
  await expect(connectionManager.getByText("E2E Mock")).toBeVisible();

  const modelManager = routingManagers.nth(1);
  await modelManager.locator("summary").click();
  await modelManager.getByRole("button", { name: "Add model" }).click();
  await modelManager.getByLabel("Connection").selectOption({
    label: "E2E Mock"
  });
  await modelManager.getByLabel("Display name").fill("E2E Streaming STT");
  await modelManager.getByLabel("Model name").fill("mock-streaming-stt");
  await modelManager.getByLabel("Declared").click();
  await modelManager.getByRole("checkbox", { name: "Audio input" }).check();
  await modelManager.getByRole("checkbox", { name: "Text output" }).check();
  await modelManager.getByRole("checkbox", { name: "Transcription" }).check();
  await modelManager
    .getByRole("checkbox", { name: "Streaming", exact: true })
    .check();
  await expect(modelManager.getByLabel("Declared")).toContainText(
    "4 capabilities selected"
  );
  await expectAccessible(page, "capability picker");
  await modelManager.getByRole("button", { name: "Done" }).click();
  await modelManager.getByRole("button", { name: "Create" }).click();
  const streamingModelItem = modelManager
    .getByText("E2E Streaming STT")
    .locator("..");
  await expect(streamingModelItem).toBeVisible();
  await streamingModelItem.getByRole("button", { name: "Edit" }).click();
  await expect(streamingModelItem.getByLabel("Display name")).toHaveValue(
    "E2E Streaming STT"
  );
  await expect(streamingModelItem.locator("form")).toBeVisible();
  await streamingModelItem.getByRole("button", { name: "Cancel" }).click();

  const routeManager = routingManagers.nth(2);
  await routeManager.locator("summary").click();
  await routeManager.getByRole("button", { name: "Add route" }).click();
  await routeManager.getByLabel("Display name").fill("E2E Streaming Route");
  await routeManager.getByLabel("Speech to text").selectOption({
    label: "E2E Streaming STT"
  });
  await routeManager.getByLabel("LLM").selectOption({
    label: "Chat · Mock Chat"
  });
  await routeManager.getByLabel("Text to speech").selectOption({
    label: "TTS · Mock TTS"
  });
  await routeManager.getByLabel("Enable STT streaming").check();
  await expect(
    routeManager.getByLabel("Enable TTS streaming")
  ).not.toBeChecked();
  await routeManager.getByRole("button", { name: "Create" }).click();
  const customRoute = routeManager
    .getByText("E2E Streaming Route")
    .locator("..");
  await expect(customRoute).toBeVisible();
  const routeTestResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/test")
  );
  await customRoute.getByRole("button", { name: "Test & activate" }).click();
  expect((await routeTestResponse).status()).toBe(200);
  await expect(page.getByRole("alert")).toContainText(
    "Streaming routes cannot be activated"
  );
  await expectAccessible(page, "English dark provider settings");
  const nativeRoute = routeManager
    .getByText("Default Native Voice")
    .locator("..");
  await nativeRoute.getByRole("button", { name: "Test & activate" }).click();
  await expect(routeManager.getByRole("status")).toContainText(
    "Route test succeeded and the route is active."
  );
  await expect(nativeRoute.getByText("Active route")).toBeVisible();
  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("meter", { name: "Microphone level" })
  ).toHaveAttribute("aria-valuenow", "67");
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    page.getByText("Native multimodal model reports living-room-light is on.")
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "AI Providers" }).click();
  const returnedRoutes = page.locator("details.routing-management").nth(2);
  await returnedRoutes.locator("summary").click();
  const composedRoute = returnedRoutes
    .getByText("Default Composed Voice")
    .locator("..");
  await composedRoute.getByRole("button", { name: "Test & activate" }).click();
  await expect(returnedRoutes.getByRole("status")).toContainText(
    "Route test succeeded and the route is active."
  );
  await expect(composedRoute.getByText("Active route")).toBeVisible();

  await page.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/section=security/);
  await page.getByLabel("Current password").fill(password);
  await page
    .getByLabel("New password", { exact: true })
    .fill(replacementPassword);
  await page.getByLabel("Confirm new password").fill(replacementPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByRole("heading", { name: "Administrator sign in" })
  ).toBeVisible();
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel("Password").fill(replacementPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await page.goto("/missing-route");
  await expect(page.getByRole("alert")).toContainText("Route not found:");
  await expectAccessible(page, "English dark not-found");
});
