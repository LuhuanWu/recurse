import { expect } from "bun:test";
import { expect as browserExpect } from "playwright/test";
import {
  expectHitCorners,
  gotoRoot,
  runBrowserTests,
  screenshot,
  showAgentList,
  startNewAgent,
  type BrowserTest,
} from "./common";

export const tests: BrowserTest[] = [
  // Regression: #PR unsent new-agent drafts stay reachable and isolated after navigation.
  async function test_new_agent_drafts_survive_navigation(browser, base) {
    for (const width of [1280, 412]) {
      const context = await browser.newContext({
        viewport: { width, height: 915 },
        hasTouch: width === 412,
        isMobile: width === 412,
      });
      const page = await context.newPage();
      const creations: unknown[] = [];
      const deliveries: unknown[] = [];
      page.on("request", (request) => {
        if (request.method() !== "POST") return;
        if (request.url() === `${base}api/conversations`)
          creations.push(request.postDataJSON());
        if (request.url().endsWith("/deliver"))
          deliveries.push(request.postDataJSON());
      });
      try {
        await gotoRoot(page, base);
        const savedId = await page
          .locator(".agent.selected")
          .getAttribute("data-id");
        const input = page.locator("#input");
        await input.fill("Saved conversation text");
        await startNewAgent(page);
        await input.fill("Reply only resumed first draft");
        await page.locator("#model-trigger").click();
        await page
          .getByRole("slider", { name: "Effort level", exact: true })
          .fill("2");
        await page.keyboard.press("Escape");
        const firstModel = await page.locator("#model-trigger").textContent();
        await page.locator("#file-input").setInputFiles({
          name: "draft-notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Only the first draft owns these notes."),
        });
        await page.locator(".attach-chip:not(.uploading)").waitFor();
        await showAgentList(page);
        await page.locator(`.agent[data-id="${savedId}"]`).click();
        await browserExpect(input).toHaveValue("Saved conversation text");
        await showAgentList(page);
        const first = page.getByRole("button", {
          name: "Resume draft: Reply only resumed first draft",
          exact: true,
        });
        await browserExpect(first).toBeVisible();
        expect(creations).toHaveLength(0);
        expect(deliveries).toHaveLength(0);
        await expectHitCorners(first);
        await first.focus();
        await page.keyboard.press("Enter");
        await browserExpect(input).toHaveValue(
          "Reply only resumed first draft",
        );
        await browserExpect(page.locator("#model-trigger")).toHaveText(
          firstModel!,
        );
        await browserExpect(page.locator(".attach-chip")).toContainText(
          "draft-notes.txt",
        );
        await startNewAgent(page);
        await browserExpect(input).toHaveValue("");
        await browserExpect(page.locator(".attach-chip")).toHaveCount(0);
        await input.fill("Second independent draft");
        await showAgentList(page);
        await screenshot(page, `drafts/retained-${width}`);
        await first.click();
        await browserExpect(input).toHaveValue(
          "Reply only resumed first draft",
        );
        await browserExpect(page.locator("#model-trigger")).toHaveText(
          firstModel!,
        );
        const created = page.waitForResponse(
          (response) =>
            response.url() === `${base}api/conversations` &&
            response.request().method() === "POST",
        );
        await page.locator("#send").click();
        const newId = (await (await created).json()).id;
        await browserExpect(
          page
            .locator("#messages .assistant")
            .filter({ hasText: "resumed first draft" }),
        ).toBeVisible();
        expect(creations).toHaveLength(1);
        expect(creations[0]).toMatchObject({ level: 2, parent: null });
        expect(deliveries).toHaveLength(1);
        await showAgentList(page);
        await browserExpect(first).toHaveCount(0);
        await page
          .getByRole("button", {
            name: "Resume draft: Second independent draft",
            exact: true,
          })
          .click();
        await browserExpect(input).toHaveValue("Second independent draft");
        await browserExpect(page.locator(".attach-chip")).toHaveCount(0);
        await showAgentList(page);
        const discard = page.getByRole("button", {
          name: "Discard draft: Second independent draft",
          exact: true,
        });
        page.once("dialog", (dialog) => dialog.dismiss());
        await discard.click();
        await browserExpect(discard).toBeVisible();
        page.once("dialog", (dialog) => dialog.accept());
        await discard.click();
        await browserExpect(discard).toHaveCount(0);
        expect(creations).toHaveLength(1);
        expect(deliveries).toHaveLength(1);
        await page.request.delete(`${base}api/conversations/${newId}`);
      } finally {
        await context.close();
      }
    }
  },
];

if (import.meta.main) await runBrowserTests([["new-agent-drafts", tests]]);
