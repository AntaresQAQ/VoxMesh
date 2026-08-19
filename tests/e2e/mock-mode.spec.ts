import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const password = "correct horse battery staple";
const replacementPassword = "replacement horse battery staple";

test("completes setup, tool-assisted chat, inspection, and logout", async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await expect(
    page.getByRole("heading", { name: "Create administrator password" })
  ).toBeVisible();
  await expectAccessible(page, "English dark setup");
  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(
    page.getByRole("heading", { name: "创建管理员密码" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "创建管理员密码" })
  ).toBeVisible();
  await page.getByLabel("语言").selectOption("en");

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

  await page.getByRole("link", { name: "Conversations" }).click();
  await page.getByRole("link", { name: /Check the light status/ }).click();
  await expect(page).toHaveURL(/\/conversations\/[^/]+$/);
  await expect(page.getByText("living-room-light is on.")).toBeVisible();
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
  await expect(page.getByText("Calling MCP tool")).toBeVisible();
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
  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "显示语言" })).toBeVisible();
  await expectAccessible(page, "Simplified Chinese dark settings");
  await page.reload();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("语言").selectOption("en");

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

  await page.getByRole("button", { name: "Save LLM settings" }).click();
  await expect(page.getByText("LLM configuration saved.")).toBeVisible();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Connection test:/)).toBeVisible();

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
