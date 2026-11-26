import { expect } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect as browserExpect } from "playwright/test";
import { retire } from "../../src/utils/trash";
import { openExplorer } from "./explorer_support";
import { expectPhoneTapArea } from "./fixtures/html_preview";
import {
  dispatchArtifactSelection,
  openPage,
  postFixture,
  runBrowserTests,
  screenshot,
  type BrowserTest,
} from "./common";

export const tests: BrowserTest[] = [
  // Feature: #0 Explorer renders Markdown while retaining paged source, editing and comments.
  async function test_explorer_markdown_preview_and_source(
    browser,
    base,
    data,
  ) {
    const root = await mkdtemp(join(data, "data", "explorer-markdown-"));
    const source = `# Working notes

A **readable** document with \`inline code\` and \\(x^2\\).

| Feature | Status |
| --- | --- |
| Preview | Ready |

\`\`\`typescript
const ready = true;
\`\`\`

\`\`\`mermaid
flowchart LR
  Source --> Preview
\`\`\`

[Details](#details) · [Sibling](other.md) · [Website](https://example.com/)

![Local dot](dot.png)
![Remote image](https://example.com/explorer-test.png)
<script>window.explorerUnsafe = true</script>

## Details

${"Bounded Markdown pages keep the rest available through Load more.\n\n".repeat(300)}
## End of document
`;
    try {
      await writeFile(
        join(root, "dot.png"),
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQImWNgAAIAAAUAAYXKMgwAAAAASUVORK5CYII=",
        "base64",
      );
      for (const width of [1280, 412]) {
        const name = width === 1280 ? "notes.md" : "notes.MARKDOWN";
        await writeFile(join(root, name), source);
        const { agent } = await postFixture(base, "seed-file-edit", {
          agent: `markdown-${width}`,
          workdir: root,
        });
        const { context, page } = await openPage(browser, {
          viewport: { width, height: 915 },
          touch: width === 412,
        });
        try {
          const reads: string[] = [];
          const external: string[] = [];
          page.on("request", (request) => {
            if (request.url().includes("/tree/file?"))
              reads.push(request.url());
            if (request.url().startsWith("https://example.com/"))
              external.push(request.url());
          });
          await page.goto(`${base}#agent=${agent}`, {
            waitUntil: "domcontentloaded",
          });
          await openExplorer(page, width);
          const tree = page.locator('.pane-col[data-pane="explorer"]');
          await tree.locator(`.explorer-row[data-path="${name}"]`).click();
          const pane =
            width === 1280 ? page.locator(".pane-col.file-tab") : tree;
          const preview = pane.locator(".explorer-markdown");
          const modes = pane.getByRole("group", { name: "Markdown view" });
          const sourceMode = modes.getByRole("button", {
            name: "Source",
            exact: true,
          });
          const previewMode = modes.getByRole("button", {
            name: "Preview",
            exact: true,
          });
          await preview
            .getByRole("heading", { name: "Working notes", exact: true })
            .waitFor();
          await preview.locator(".mermaid-host svg").waitFor();
          await preview.locator(".katex").waitFor();
          await browserExpect(
            preview.getByRole("cell", { name: "Ready", exact: true }),
          ).toBeVisible();
          await browserExpect(preview.locator("pre code")).toContainText(
            "const ready = true;",
          );
          await browserExpect(
            preview.locator('img[alt="Local dot"]'),
          ).toBeVisible();
          await browserExpect(
            preview.getByRole("button", {
              name: "Show image from example.com",
            }),
          ).toBeVisible();
          expect(external).toEqual([]);
          expect(
            await page.evaluate(() => (globalThis as any).explorerUnsafe),
          ).toBeUndefined();
          await browserExpect(
            preview.getByText("Sibling", { exact: true }),
          ).not.toHaveAttribute("href");
          await browserExpect(
            preview.getByRole("link", { name: "Website" }),
          ).toHaveAttribute("rel", "noopener noreferrer");
          await browserExpect(previewMode).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          expect(reads).toHaveLength(1);
          if (width === 412) {
            await expectPhoneTapArea(sourceMode);
            await expectPhoneTapArea(previewMode);
          }
          await screenshot(page, `explorer-markdown/${width}-preview`);
          const url = page.url();
          await preview
            .getByRole("link", { name: "Details", exact: true })
            .click();
          expect(page.url()).toBe(url);
          await pane
            .getByRole("button", { name: "Load more", exact: true })
            .click();
          await preview
            .getByRole("heading", { name: "End of document" })
            .waitFor();
          expect(reads).toHaveLength(2);
          if (width === 1280) {
            await sourceMode.focus();
            await page.keyboard.press("Enter");
          } else await sourceMode.tap();
          const code = pane.locator(".explorer-source");
          await browserExpect(code).toBeVisible();
          expect(await code.textContent()).toBe(source);
          await screenshot(page, `explorer-markdown/${width}-source`);
          await dispatchArtifactSelection(
            page,
            width === 412 ? "touch" : "mouse",
            "Working notes",
            code,
          );
          const popover = page.locator(".report-comment-popover");
          await popover.locator("textarea").fill("Keep this heading.");
          await popover
            .getByRole("button", { name: "Comment", exact: true })
            .click();
          await pane.locator(".report-comment").waitFor();
          const sourceNode = await code.elementHandle();
          await previewMode.click();
          await browserExpect(code).not.toBeVisible();
          await browserExpect(
            pane.locator(".report-comment"),
          ).not.toBeVisible();
          await previewMode.focus();
          await page.keyboard.press("Escape");
          await pane.waitFor({ state: "detached" });
          await openExplorer(page, width);
          if (width === 1280)
            await tree.locator(`.explorer-row[data-path="${name}"]`).click();
          await preview
            .getByRole("heading", { name: "Working notes", exact: true })
            .waitFor();
          await sourceMode.click();
          expect(await sourceNode!.evaluate((node) => node.isConnected)).toBe(
            true,
          );
          await browserExpect(pane.locator("mark.report-cmark")).toHaveText(
            "Working notes",
          );
          await browserExpect(
            pane.locator(".report-comment textarea"),
          ).toHaveValue("Keep this heading.");
          await previewMode.click();
          await pane.getByRole("button", { name: "Edit", exact: true }).click();
          const edited = "# Updated notes\n\nSaved from Explorer.\n";
          await pane.getByRole("textbox", { name: "File text" }).fill(edited);
          await pane.getByRole("button", { name: "Save", exact: true }).click();
          await pane.getByText("Saved.", { exact: true }).waitFor();
          await preview
            .getByRole("heading", { name: "Updated notes" })
            .waitFor();
          expect(await readFile(join(root, name), "utf8")).toBe(edited);
          await page
            .locator("#messages .msg.assistant", { hasText: "Acknowledged." })
            .waitFor({ state: "attached" });
          const captured = await postFixture(base, "file-edit-captures", {
            agent,
          });
          expect(captured.providerRequests.join("\n")).toContain(
            `I edited ${root}/${name}`,
          );
          const dimensions = await pane
            .locator(".pane-body")
            .evaluate((node) => [node.scrollWidth, node.clientWidth]);
          expect(dimensions[0]!).toBeLessThanOrEqual(dimensions[1]!);
        } finally {
          await context.close();
        }
      }
    } finally {
      retire(root, join(data, "data", "trash"));
    }
  },
];
if (import.meta.main) await runBrowserTests([["explorer-markdown", tests]]);
