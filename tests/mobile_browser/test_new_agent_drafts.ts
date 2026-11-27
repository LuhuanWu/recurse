import { expect } from "bun:test";
import { expect as browserExpect } from "playwright/test";
import { MAX_RETAINED_OWNERS } from "../../web/conversation-ui-state/schema";
import {
  expectHitCorners,
  gotoRoot,
  postFixture,
  runBrowserTests,
  screenshot,
  showAgentList,
  startNewAgent,
  type BrowserTest,
} from "./common";

export const tests: BrowserTest[] = [
  // Regression: #1 unsent new-agent drafts stay reachable and isolated after navigation.
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
        if (width === 1280) {
          const { agent } = await postFixture(base, "seed-side-history");
          expect(
            (
              await page.request.post(
                `${base}api/conversations/${agent}/reparent`,
                { data: { parent: null } },
              )
            ).ok(),
          ).toBe(true);
          await page.goto(`${base}#agent=${agent}`);
        } else await gotoRoot(page, base);
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
        if (width === 1280) {
          const side = await page.request.post(
            `${base}api/conversations/${savedId}/side`,
            { data: {} },
          );
          expect(side.ok(), await side.text()).toBe(true);
          const sideId = (await side.json()).id;
          await page.locator('.rail-btn[data-pane="side"]').click();
          const sideInput = page
            .frameLocator(`iframe[data-side="${sideId}"]`)
            .locator("#input");
          await sideInput.waitFor();
          await page.evaluate(() => {
            const browser = globalThis as any;
            browser.__draftStorageChanged = false;
            const listener = (event: StorageEvent) => {
              if (event.storageArea !== sessionStorage) return;
              removeEventListener("storage", listener);
              browser.__draftStorageChanged = true;
            };
            addEventListener("storage", listener);
          });
          await sideInput.fill(
            "Side conversation draft triggers shared-tab storage invalidation",
          );
          await page.waitForFunction(
            () => (globalThis as any).__draftStorageChanged,
          );
          await page.locator('.rail-btn[data-pane="side"]').click();
        }
        await showAgentList(page);
        const first = page.getByRole("button", {
          name: "Resume draft: Reply only resumed first draft",
          exact: true,
        });
        await browserExpect(first).toBeVisible();
        expect(creations).toHaveLength(0);
        expect(deliveries).toHaveLength(0);
        await expectHitCorners(first, width === 1280 ? 40 : 44);
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
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        let noteCreated!: (id: string) => void;
        const createdOnServer = new Promise<string>(
          (resolve) => (noteCreated = resolve),
        );
        await page.route(`${base}api/conversations`, async (route) => {
          const response = await route.fetch();
          noteCreated((await response.json()).id);
          await held;
          await route.fulfill({ response });
        });
        const created = page.waitForResponse(
          (response) =>
            response.url() === `${base}api/conversations` &&
            response.request().method() === "POST",
        );
        const second = page.getByRole("button", {
          name: "Resume draft: Second independent draft",
          exact: true,
        });
        try {
          await page.locator("#send").click();
          await input.fill("Unsent follow-up stays with first draft");
          await showAgentList(page);
          await second.click();
          await browserExpect(input).toHaveValue("Second independent draft");
          const newId = await createdOnServer;
          await showAgentList(page);
          const saved = page.locator(`.agent[data-id="${newId}"]`);
          await saved.waitFor();
          await browserExpect(
            page.locator(".draft-row.selected"),
          ).toContainText("Second independent draft");
          await saved.click();
          await browserExpect(input).toHaveValue("");
          await input.fill("Independently typed destination text");
          await input.evaluate((element) =>
            (element as HTMLTextAreaElement).setSelectionRange(4, 4),
          );
          release();
          await created;
          await browserExpect(input).toHaveValue(
            "Unsent follow-up stays with first draft\nIndependently typed destination text",
          );
          expect(
            await input.evaluate(
              (element) => (element as HTMLTextAreaElement).selectionStart,
            ),
          ).toBe("Unsent follow-up stays with first draft\n".length + 4);
          await page
            .locator("#messages .assistant")
            .filter({ hasText: "resumed first draft" })
            .waitFor();
          expect(creations).toHaveLength(1);
          expect(creations[0]).toMatchObject({ level: 2, parent: null });
          expect(deliveries).toHaveLength(1);
          await showAgentList(page);
          await browserExpect(first).toHaveCount(0);
          await second.click();
          await browserExpect(input).toHaveValue("Second independent draft");
          await browserExpect(page.locator(".attach-chip")).toHaveCount(0);
          await page.request.delete(`${base}api/conversations/${newId}`);
        } finally {
          release();
          await page.unroute(`${base}api/conversations`);
        }
        await page.locator("#file-input").setInputFiles({
          name: "discard-notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Discard only this draft's staged file."),
        });
        await page.locator(".attach-chip:not(.uploading)").waitFor();
        await showAgentList(page);
        const discard = page.getByRole("button", {
          name: "Discard draft: Second independent draft",
          exact: true,
        });
        await expectHitCorners(discard, width === 1280 ? 36 : 44);
        page.once("dialog", (dialog) => dialog.dismiss());
        await discard.click();
        await browserExpect(discard).toBeVisible();
        const removed = page.waitForResponse(
          (response) =>
            response.request().method() === "DELETE" &&
            response.url().includes("/api/attachments/"),
        );
        page.once("dialog", (dialog) => dialog.accept());
        await discard.click();
        expect((await removed).ok()).toBe(true);
        await browserExpect(discard).toHaveCount(0);
        expect(creations).toHaveLength(1);
        expect(deliveries).toHaveLength(1);
      } finally {
        await context.close();
      }
    }
  },
  // Regression: #1 retained failed creations remain retryable and discardable under custom sidebars.
  async function test_failed_drafts_keep_settings_and_can_be_discarded(
    browser,
    base,
  ) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 915 },
    });
    const settings = await (
      await page.request.get(`${base}api/sidebar/script`)
    ).json();
    const script = `export const newAgent = { ask: "tag", defaults: { draftwork: { effort: 2 } } };
      export default rows => [{ title: "Draft work", rows, actions: [{ label: "New agent", start: true, set: "draftwork" }] }];`;
    await postFixture(base, "save-sidebar-script", { script, by: "operator" });
    let refused = true;
    let refuseDelivery = false;
    const refusedDeliveries: unknown[] = [];
    await page.route(`${base}api/conversations/*/deliver`, async (route) => {
      if (!refuseDelivery) return route.continue();
      refusedDeliveries.push(route.request().postDataJSON());
      await route.fulfill({
        status: 422,
        json: { detail: "Delivery refused for this regression" },
      });
    });
    const creations: unknown[] = [];
    await page.route(`${base}api/conversations`, async (route) => {
      creations.push(route.request().postDataJSON());
      if (refused)
        await route.fulfill({
          status: 422,
          json: { detail: "Creation refused for this regression" },
        });
      else await route.continue();
    });
    try {
      await gotoRoot(page, base);
      const savedId = await page
        .locator(".agent.selected")
        .getAttribute("data-id");
      const section = page.locator(
        '.tree-section-header[data-section-key=\'["","Draft work"]\']',
      );
      await section.hover();
      await section
        .getByRole("button", { name: "New agent", exact: true })
        .click();
      await page.locator("#input").fill("Reply only recovered failed draft");
      await page.locator("#send").click();
      await browserExpect(page.locator("#send-status")).toContainText(
        "Creation refused",
      );
      await page.locator(`.agent[data-id="${savedId}"]`).click();
      await page
        .getByRole("button", {
          name: "Resume draft: Reply only recovered failed draft",
          exact: true,
        })
        .click();
      await browserExpect(
        page.getByRole("button", {
          name: "Discard draft: Reply only recovered failed draft",
          exact: true,
        }),
      ).toBeEnabled();
      refused = false;
      await page.locator("#send-status").click();
      await page
        .locator("#messages .assistant")
        .filter({ hasText: "recovered failed draft" })
        .waitFor();
      expect(creations).toHaveLength(2);
      expect(creations[0]).toMatchObject({ tags: ["draftwork"], level: 2 });
      expect(creations[1]).toEqual(creations[0]);
      const createdId = await page
        .locator(".agent.selected")
        .getAttribute("data-id");
      refuseDelivery = true;
      await startNewAgent(page);
      await page.locator("#input").fill("Discard failed draft without retry");
      await page.locator("#send").click();
      await browserExpect(page.locator("#send-status")).toContainText(
        "Delivery refused",
      );
      await page.locator(`.agent[data-id="${savedId}"]`).click();
      await page
        .getByRole("button", {
          name: "Resume draft: Discard failed draft without retry",
          exact: true,
        })
        .click();
      const followerRefusal = page.waitForResponse(
        (response) =>
          response.url().endsWith("/deliver") && response.status() === 422,
      );
      await page.locator("#input").fill("Discard this related follow-up too");
      await page.locator("#send").click();
      await followerRefusal;
      await browserExpect(
        page.getByRole("button", {
          name: "Discard draft: Discard failed draft without retry",
          exact: true,
        }),
      ).toBeEnabled();
      expect(
        await page.evaluate(
          () =>
            Object.keys(localStorage).filter((key) =>
              key.startsWith("recurse-composer-outbox-v1:"),
            ).length,
        ),
      ).toBe(0);
      await page.locator(`.agent[data-id="${savedId}"]`).click();
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", {
          name: "Discard draft: Discard failed draft without retry",
          exact: true,
        })
        .click();
      await browserExpect(page.locator(".draft-row")).toHaveCount(0);
      await browserExpect(page.locator("#send-status")).toBeHidden();
      expect(creations).toHaveLength(3);
      expect(refusedDeliveries).toHaveLength(2);
      await page.reload();
      await page.locator(`.agent.selected[data-id="${savedId}"]`).waitFor();
      await browserExpect(page.locator("#send-status")).toBeHidden();
      await browserExpect(page.locator(".draft-row")).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            Object.keys(localStorage).filter((key) =>
              key.startsWith("recurse-composer-outbox-v1:"),
            ).length,
        ),
      ).toBe(0);
      expect(refusedDeliveries).toHaveLength(2);
      await page.request.delete(`${base}api/conversations/${createdId}`);
    } finally {
      await page.close();
      await postFixture(base, "save-sidebar-script", {
        script: settings.default,
        by: "operator",
      });
    }
  },
  // Regression: #1 login recovery cannot consume a newly opened draft as the saved owner.
  async function test_login_recovery_keeps_draft_ownership(browser, base) {
    for (const draft of [false, true]) {
      console.log(
        `Login recovery: ${draft ? "new draft" : "saved conversation"}`,
      );
      const page = await browser.newPage({
        viewport: { width: 1280, height: 915 },
      });
      let expired = false;
      let holdTree = false;
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let creations = 0;
      page.on("request", (request) => {
        if (request.isNavigationRequest()) expired = false;
        if (
          request.method() === "POST" &&
          request.url() === `${base}api/conversations`
        )
          creations++;
      });
      await page.route(`${base}api/**`, async (route) => {
        if (expired)
          return route.fulfill({
            status: 401,
            json: { detail: "Session expired" },
          });
        if (holdTree && route.request().url() === `${base}api/tree`) await held;
        await route.continue();
      });
      try {
        await gotoRoot(page, base);
        const savedId = await page
          .locator(".agent.selected")
          .getAttribute("data-id");
        if (draft) await startNewAgent(page);
        else {
          await startNewAgent(page);
          await page.locator("#input").fill(" \n");
          await page.locator(`.agent[data-id="${savedId}"]`).click();
          await browserExpect(page.locator(".draft-row")).toHaveCount(0);
          expect(
            await page.evaluate(() =>
              dispatchEvent(
                new Event("recurse:update-ready", { cancelable: true }),
              ),
            ),
          ).toBe(true);
        }
        await page.locator("#input").fill("Keep this through login");
        expired = true;
        await page.evaluate(() => dispatchEvent(new Event("focus")));
        const login = page
          .locator("#connection-status")
          .getByRole("button", { name: "Log in", exact: true });
        await login.waitFor();
        holdTree = true;
        const reloaded = page.waitForEvent("domcontentloaded");
        await login.click();
        await browserExpect(
          page.locator("#connection-announcement"),
        ).not.toContainText("could not be saved");
        await reloaded;
        await browserExpect(page.locator("#input")).toHaveValue(
          "Keep this through login",
        );
        if (!draft) {
          const dialog = page.waitForEvent("dialog");
          const started = startNewAgent(page);
          const notice = await dialog;
          expect(notice.message()).toContain("recovered message");
          await notice.accept();
          await started;
          await browserExpect(page.locator(".draft-row")).toHaveCount(0);
        }
        release();
        await page.locator(`.agent[data-id="${savedId}"]`).waitFor();
        if (draft) {
          await page.locator(`.agent[data-id="${savedId}"]`).click();
          await browserExpect(page.locator("#input")).toHaveValue("");
          await page
            .getByRole("button", {
              name: "Resume draft: Keep this through login",
              exact: true,
            })
            .click();
        }
        await browserExpect(page.locator("#input")).toHaveValue(
          "Keep this through login",
        );
        expect(creations).toBe(0);
      } finally {
        release();
        await page.close();
      }
    }
  },
  // Regression: #1 retained drafts survive real owner-cache eviction until explicit discard.
  async function test_draft_owner_survives_cache_pressure(browser, base) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 915 },
    });
    const ids: string[] = [];
    const deleted: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "DELETE" &&
        request.url().includes("/api/attachments/")
      )
        deleted.push(request.url());
    });
    try {
      for (let i = 0; i <= MAX_RETAINED_OWNERS; i++) {
        const response = await page.request.post(`${base}api/conversations`, {
          data: { title: `Draft retention visit ${i}`, parent: null },
        });
        expect(response.ok()).toBe(true);
        ids.push((await response.json()).id);
      }
      await gotoRoot(page, base);
      await page
        .locator(`.agent[data-id="${ids.at(-1)}"]`)
        .waitFor({ state: "attached" });
      await startNewAgent(page);
      await page
        .locator("#input")
        .fill("Retain this oldest draft and its file");
      const uploaded = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/attachments"),
      );
      await page.locator("#file-input").setInputFiles({
        name: "retained.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("retained"),
      });
      const attachment = await (await uploaded).json();
      await page.locator(".attach-chip:not(.uploading)").waitFor();
      for (const id of ids) {
        await page.evaluate((id) => {
          location.hash = `agent=${id}`;
        }, id);
        await page
          .locator(`.agent.selected[data-id="${id}"]`)
          .waitFor({ state: "attached" });
        await page.locator("#file-input").setInputFiles({
          name: "visited.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("visited"),
        });
        await page.locator(".attach-chip:not(.uploading)").waitFor();
      }
      const resume = page.getByRole("button", {
        name: "Resume draft: Retain this oldest draft and its file",
        exact: true,
      });
      await resume.click();
      await browserExpect(page.locator("#input")).toHaveValue(
        "Retain this oldest draft and its file",
      );
      await browserExpect(page.locator(".attach-chip")).toContainText(
        "retained.txt",
      );
      expect(deleted.length).toBeGreaterThan(0);
      expect(deleted.some((url) => url.includes(attachment.id))).toBe(false);
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", {
          name: "Discard draft: Retain this oldest draft and its file",
          exact: true,
        })
        .click();
      await browserExpect
        .poll(() => deleted.some((url) => url.includes(attachment.id)))
        .toBe(true);
      await browserExpect(resume).toHaveCount(0);
    } finally {
      await page.close();
    }
  },
];

if (import.meta.main) await runBrowserTests([["new-agent-drafts", tests]]);
