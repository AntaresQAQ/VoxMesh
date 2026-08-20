import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const password = "correct horse battery staple";
const replacementPassword = "replacement horse battery staple";

test("completes setup, tool-assisted chat, inspection, and logout", async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => undefined }]
        })
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
  await expectAccessible(page, "English dark dashboard");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Manage routing" })
  ).toBeFocused();

  await page.getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "Chat" })).toBeFocused();
  await page.getByLabel("Message").fill("Check the light status");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Mock tool reports living-room-light is on.")
  ).toBeVisible();
  await expect(page.getByText("Tools: mock.get_device_status")).toBeVisible();
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
    .first()
    .click();
  await expect(page).toHaveURL(/\/conversations\/[^/]+$/);
  await expect(page.getByText("living-room-light is on.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Processing pipeline" })
  ).toBeVisible();
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
          body: JSON.stringify({ message: `Overflow test ${index}` })
        })
      )
    );
    if (responses.some((response) => !response.ok)) {
      throw new Error("Failed to create overflow test data");
    }
  });
  await page.getByRole("link", { name: "Logs" }).click();
  await expect(page.getByText("Calling MCP tool").first()).toBeVisible();
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
  await page.reload();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("语言", { exact: true }).selectOption("en");

  await page.getByLabel("Theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectAccessible(page, "English light settings");
  await page.setViewportSize({ width: 360, height: 667 });
  const responsiveWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(responsiveWidth.content).toBeLessThanOrEqual(
    responsiveWidth.viewport + 1
  );
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

async function expectAccessible(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations,
    `${context}: ${results.violations
      .map((violation) => `${violation.id} (${violation.nodes.length})`)
      .join(", ")}`
  ).toEqual([]);
}
