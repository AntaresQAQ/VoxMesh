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
  await expectAccessible(page, "English dark dashboard");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" })
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

  await page.route("**/api/config/llm", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          mode: "openai-compatible",
          endpoint: "",
          deployment: "",
          apiVersion: "2024-10-21",
          baseUrl: "https://saved.example.com/v1",
          model: "saved-model",
          timeoutMs: 30_000,
          maxOutputTokens: 1_024,
          apiKeyConfigured: true
        }
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/config/speech", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          sttMode: "openai-compatible",
          ttsMode: "azure-openai",
          sttEndpoint: "https://saved-stt.example.com/v1",
          sttDeployment: "saved-stt-model",
          sttApiVersion: "2025-04-01-preview",
          sttLanguage: "zh",
          sttApiKeyConfigured: true,
          ttsEndpoint: "https://saved-tts.openai.azure.com",
          ttsDeployment: "saved-tts-model",
          ttsApiVersion: "2025-03-01-preview",
          ttsVoice: "coral",
          ttsInstructions: "Speak clearly and naturally.",
          ttsApiKeyConfigured: true
        }
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("link", { name: "AI Providers" }).click();
  await expect(page).toHaveURL(/section=providers/);
  await expect(
    page.getByRole("heading", { name: "Runtime routing" })
  ).toBeVisible();
  await expect(page.getByText("Default Composed Voice")).toBeVisible();
  await expect(page.getByText("Chat · Mock", { exact: true })).toBeVisible();
  await expectAccessible(page, "English dark provider settings");
  const llmSettings = page
    .getByRole("heading", { name: "LLM provider" })
    .locator("..");
  await expect(llmSettings.getByLabel("Provider", { exact: true })).toHaveValue(
    "openai-compatible"
  );
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Connection test:/)).toBeVisible();
  await expect(llmSettings.getByLabel("Provider", { exact: true })).toHaveValue(
    "openai-compatible"
  );
  await expect(llmSettings.getByLabel("Base URL")).toHaveValue(
    "https://saved.example.com/v1"
  );
  await llmSettings
    .getByLabel("Provider", { exact: true })
    .selectOption("mock");
  await page.getByRole("button", { name: "Save LLM settings" }).click();
  await expect(page.getByText("LLM configuration saved.")).toBeVisible();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Connection test:/)).toBeVisible();
  await expect(page.getByLabel("STT provider")).toHaveValue(
    "openai-compatible"
  );
  await expect(page.getByLabel("TTS provider")).toHaveValue("azure-openai");
  await page.getByRole("button", { name: "Test speech connection" }).click();
  await expect(page.getByText(/Speech test: transcript/)).toBeVisible();
  await expect(page.getByLabel("STT provider")).toHaveValue(
    "openai-compatible"
  );
  await expect(page.getByLabel("TTS provider")).toHaveValue("azure-openai");
  await expect(page.getByLabel("STT endpoint")).toHaveValue(
    "https://saved-stt.example.com/v1"
  );
  await expect(page.getByLabel("TTS endpoint")).toHaveValue(
    "https://saved-tts.openai.azure.com"
  );
  await page.getByLabel("STT provider").selectOption("azure-openai");
  await page.getByLabel("TTS provider").selectOption("mock");
  await page.unroute("**/api/config/llm");
  await page.unroute("**/api/config/speech");
  await page.getByLabel("STT provider").selectOption("alibaba-model-studio");
  await page.getByLabel("TTS provider").selectOption("alibaba-model-studio");
  await expect(
    page.getByText(/dedicated Model Studio WebSocket protocol/).first()
  ).toBeVisible();
  await page
    .getByLabel("STT endpoint")
    .fill("wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference");
  await page.getByLabel("STT deployment").fill("fun-asr-realtime");
  await page.getByLabel("STT API key").fill("offline-stt-secret");
  await page
    .getByLabel("TTS endpoint")
    .fill("wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference");
  await page.getByLabel("TTS deployment").fill("qwen-audio-3.0-tts-plus");
  await page.getByLabel("TTS voice").fill("longanlingxin");
  await page.getByLabel("TTS API key").fill("offline-tts-secret");
  await page.getByRole("button", { name: "Save speech settings" }).click();
  await expect(page.getByText("Speech configuration saved.")).toBeVisible();
  await page.getByLabel("STT provider").selectOption("azure-openai");
  await page.getByLabel("TTS provider").selectOption("mock");
  const speechPanelHeights = await page
    .locator(".speech-provider-grid fieldset")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height)
    );
  expect(speechPanelHeights[0]).toBeGreaterThan(speechPanelHeights[1] ?? 0);
  await page.getByLabel("STT provider").selectOption("mock");
  await page.getByRole("button", { name: "Save speech settings" }).click();
  await expect(page.getByText("Speech configuration saved.")).toBeVisible();
  await page.getByRole("button", { name: "Test speech connection" }).click();
  await expect(page.getByText(/Speech test: transcript/)).toBeVisible();

  await page
    .getByLabel("Voice pipeline mode")
    .selectOption("native-multimodal");
  await expect(page.getByLabel("Native multimodal provider")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "LLM provider" })
  ).not.toBeVisible();
  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    page.getByText("Native multimodal model reports living-room-light is on.")
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "AI Providers" }).click();
  await page.getByLabel("Voice pipeline mode").selectOption("composed");

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
