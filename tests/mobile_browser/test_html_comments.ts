import { expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect as browserExpect } from "playwright/test";
import { openExplorer } from "./explorer_support";
import {
  openPage,
  postFixture,
  runBrowserTests,
  screenshot,
  type BrowserTest,
} from "./common";

export const tests: BrowserTest[] = [
  // Feature: #0 bounded HTML previews stage quote-only comments through the trusted parent and real send path.
  async function test_html_preview_comments_in_explorer(browser, base, data) {
    const root = await mkdtemp(join(data, "html-comments-"));
    await writeFile(
      join(root, "report.html"),
      `<h1>Rendered report selection</h1><script type="application/json">${JSON.stringify({ values: "x".repeat(300_000) })}</script>`,
    );
    for (const width of [1280, 412]) {
      const { agent } = await postFixture(base, "seed-model-selection-error", {
        agent: `html-comments-${width}`,
        model: "fauxordinary/faux-1",
        workdir: root,
      });
      const { context, page } = await openPage(browser, {
        viewport: { width, height: 850 },
        touch: width === 412,
      });
      try {
        await page.goto(`${base}#agent=${agent}`);
        await openExplorer(page, width);
        await page.locator('.explorer-row[data-path="report.html"]').click();
        const pane =
          width === 1280
            ? page.locator(".pane-col.file-tab:visible")
            : page.locator('.pane-col[data-pane="explorer"]');
        const frame = pane.frameLocator("iframe");
        const heading = frame.getByRole("heading", {
          name: "Rendered report selection",
        });
        await heading.waitFor();
        await browserExpect(heading).toBeVisible();
        expect(
          (await pane.locator(".explorer-source code").textContent())!.length,
        ).toBeLessThanOrEqual(256 * 1024);
        const button = pane.getByRole("button", {
          name: "Comment on selection",
        });
        await browserExpect(button).toBeEnabled();
        await heading.selectText();
        await heading.evaluate(() => {
          const send = MessagePort.prototype.postMessage;
          MessagePort.prototype.postMessage = function (
            this: MessagePort,
            data: any,
          ) {
            if (data.type === "selection") {
              MessagePort.prototype.postMessage = send;
              send.call(this, { ...data, request: data.request + 1 });
            } else send.call(this, data);
          } as typeof send;
        });
        await button.click();
        await pane.getByText("Reading selection…", { exact: true }).waitFor();
        await pane.getByRole("button", { name: "Source", exact: true }).click();
        await browserExpect(pane.locator("iframe")).toHaveCount(0);
        await browserExpect(
          page.locator(".report-comment-popover"),
        ).toBeHidden();
        await pane
          .getByRole("button", { name: "Preview", exact: true })
          .click();
        await browserExpect(heading).toBeVisible();
        await browserExpect(button).toBeEnabled();
        await heading.evaluate(() => {
          const channel = new MessageChannel();
          parent.postMessage(
            {
              type: "recurse-preview-selection:connect",
              token: location.hash.slice(1),
            },
            "*",
            [channel.port2],
          );
          channel.port1.postMessage({
            type: "selection",
            request: 1,
            quote: "Replayed quote",
          });
          parent.postMessage(
            {
              type: "selection",
              request: 1,
              quote: "Forged quote",
              send: true,
            },
            "*",
          );
        });
        await heading.selectText();
        if (width === 412) await button.tap();
        else await button.press("Enter");
        const popover = page.locator(".report-comment-popover");
        await browserExpect(popover.locator("blockquote")).toHaveText(
          "Rendered report selection",
        );
        await heading.evaluate((element) => {
          element.textContent = "Updated app text";
        });
        await browserExpect(popover.locator("blockquote")).toHaveText(
          "Rendered report selection",
        );
        const reply = `Explorer HTML comment received ${width}`;
        await popover.locator("textarea").fill(`Reply only ${reply}`);
        await popover
          .getByRole("button", { name: "Comment", exact: true })
          .click();
        await browserExpect(
          pane.locator(".report-comment blockquote"),
        ).toHaveText("Rendered report selection");
        await screenshot(page, `html-comments/explorer-${width}`);
        const delivered = page.waitForRequest((request) =>
          request.url().endsWith(`/api/conversations/${agent}/deliver`),
        );
        await pane.getByRole("button", { name: "Submit comments" }).click();
        const message = (await delivered).postDataJSON().content as string;
        expect(message).toContain(`path: ${root}/report.html`);
        expect(message).toContain(
          `> Rendered report selection\nReply only ${reply}`,
        );
        expect(message).not.toContain("- line ");
        await page
          .locator(".msg.assistant .content")
          .getByText(reply, { exact: true })
          .waitFor();
      } finally {
        await context.close();
      }
    }
  },
];

if (import.meta.main) await runBrowserTests([["html-comments", tests]]);
