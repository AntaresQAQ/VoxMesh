import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function routeJson(
  page: Page,
  url: string,
  body: unknown,
  status = 200
): Promise<void> {
  await page.route(url, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body)
    })
  );
}

export async function installEventStreamFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let streamId = "fixture-stream-1";
    const sockets: FixtureSocket[] = [];

    class FixtureSocket {
      public static readonly OPEN = 1;
      public readyState = 1;
      public onopen: ((event: Event) => void) | null = null;
      public onmessage: ((event: MessageEvent) => void) | null = null;
      public onclose: ((event: CloseEvent) => void) | null = null;
      public onerror: ((event: Event) => void) | null = null;

      public constructor(public readonly url: string) {
        sockets.push(this);
        queueMicrotask(() => {
          this.onopen?.(new Event("open"));
          this.message({
            version: 1,
            type: "stream.ready",
            streamId,
            latestSequence: 0,
            oldestAvailableSequence: null
          });
        });
      }

      public close(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.onclose?.(
          new CloseEvent("close", {
            code,
            reason,
            wasClean: code === 1000
          })
        );
      }

      public message(value: unknown): void {
        this.onmessage?.(
          new MessageEvent("message", { data: JSON.stringify(value) })
        );
      }
    }

    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FixtureSocket
    });
    Object.assign(globalThis, {
      __voxmeshEventFixture: {
        gap: () =>
          sockets.at(-1)?.message({
            version: 1,
            type: "stream.gap",
            streamId,
            requestedAfter: 1,
            oldestAvailableSequence: 5,
            latestSequence: 8
          }),
        restart: () => {
          streamId = "fixture-stream-2";
          sockets.at(-1)?.message({
            version: 1,
            type: "stream.ready",
            streamId,
            latestSequence: 0,
            oldestAvailableSequence: null
          });
        }
      }
    });
  });
}

export async function sendEventStreamGap(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __voxmeshEventFixture?: { gap(): void };
      }
    ).__voxmeshEventFixture?.gap();
  });
}

export async function sendEventStreamRestart(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __voxmeshEventFixture?: { restart(): void };
      }
    ).__voxmeshEventFixture?.restart();
  });
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  if (dimensions.content > dimensions.viewport + 1) {
    throw new Error(
      `Horizontal overflow: ${dimensions.content}px content in ${dimensions.viewport}px viewport`
    );
  }
}

export async function expectAccessible(
  page: Page,
  context: string
): Promise<void> {
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

export async function expectVisibleFocus(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const outline = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth)
    };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
}
