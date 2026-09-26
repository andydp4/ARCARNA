/**
 * My run (v1.2) on a phone: a driver sees their own deliveries, reorders them
 * (kept after a reload), starts the run, says one could not be delivered
 * (back to ready, note on the board) and marks one delivered — including a
 * tap made offline that is sent when the phone is back online. Every result
 * is read back from the database, not just from the page.
 *
 * Written with the phase; run after merge with the rest of the journeys.
 */
import { devices, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { orders as ordersTable } from "@shared/schema";
import { pageAs, ROLE_USERS } from "./fixtures";
import { opsTest as test, orderInState } from "./opsFixtures";

const phone = devices["Pixel 7"];
const DRIVER = ROLE_USERS.CASHIER;

async function row(orderId: string) {
  const [r] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  return r;
}

test.describe("My run on a phone", () => {
  test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, userAgent: phone.userAgent });

  test("reorder, start run, couldn't deliver, delivered and an offline tap", async ({ browser, api, orgId, cashierB }) => {
    const mine = [];
    for (const dueIn of [30, 40, 50]) {
      mine.push(await orderInState(api, db, "ready", { fulfilment: "delivery", assignedTo: DRIVER, dueIn }));
    }
    const theirs = await orderInState(api, db, "ready", { fulfilment: "delivery", assignedTo: cashierB.userId, dueIn: 20 });
    const [a, b, c] = mine.map((o) => ({ id: o.id, code: o.id.slice(0, 8) }));

    const page = await pageAs(browser, "CASHIER", orgId);
    const dialogs = page.locator('[role="dialog"]');
    await page.goto("/my-run");
    const stop = (code: string) => page.getByTestId(`run-stop-${code}`);

    for (const s of [a, b, c]) await expect(stop(s.code)).toBeVisible({ timeout: 60_000 });
    await expect(stop(theirs.id.slice(0, 8)), "someone else's delivery is not on my run").toHaveCount(0);
    await expect(dialogs).toHaveCount(0);

    // Ours in due order: a before b before c.
    const codes = async () =>
      (await page.locator('[data-testid^="run-stop-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid"))))
        .filter((t): t is string => !!t && /^run-stop-[0-9a-f]{8}$/.test(t))
        .map((t) => t.replace("run-stop-", ""))
        .filter((code) => [a.code, b.code, c.code].includes(code));
    expect(await codes()).toEqual([a.code, b.code, c.code]);

    // Touch targets are at least 44px.
    for (const id of [`button-move-down-${a.code}`, `checkbox-run-stop-${a.code}`]) {
      const box = await page.getByTestId(id).locator("xpath=ancestor-or-self::*[self::button or self::label][1]").boundingBox();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
    }

    // Move c up to the top of ours, and it stays there after a reload.
    const saved = page.waitForResponse((r) => r.url().includes("/api/my-run/order") && r.request().method() === "PUT");
    // Other journeys may leave deliveries on this driver's run, so move c up
    // until it is ahead of ours rather than a fixed number of steps.
    for (let i = 0; i < 20 && (await codes())[0] !== c.code; i++) {
      await page.getByTestId(`button-move-up-${c.code}`).tap();
    }
    await expect.poll(codes).toEqual([c.code, a.code, b.code]);
    expect((await saved).status()).toBe(200);
    // Saves are debounced; let the last one land before reloading.
    await page.waitForTimeout(1_500);
    await page.reload();
    await expect(stop(c.code)).toBeVisible({ timeout: 30_000 });
    await expect.poll(codes).toEqual([c.code, a.code, b.code]);

    // Start run with all three.
    for (const s of [a, b, c]) await page.getByTestId(`checkbox-run-stop-${s.code}`).check();
    await page.getByTestId("button-start-run").tap();
    await expect(page.getByTestId("my-run-message")).toContainText("out for delivery");
    await expect(page.getByTestId(`button-delivered-${a.code}`)).toBeVisible();
    for (const s of [a, b, c]) expect((await row(s.id)).outForDeliveryAt, s.code).not.toBeNull();

    // Couldn't deliver a: No answer, with a note — back to ready, on the board.
    await page.getByTestId(`button-couldnt-deliver-${a.code}`).tap();
    await expect(dialogs, "the reason chips are inline, not a pop-up").toHaveCount(0);
    await page.getByTestId("chip-reason-no_answer").tap();
    await page.getByLabel("Note (optional)").fill("rang twice");
    await page.getByTestId(`button-send-couldnt-deliver-${a.code}`).tap();
    await expect(page.getByTestId(`run-stop-issue-${a.code}`)).toContainText("No answer");
    const failed = await row(a.id);
    expect(failed.outForDeliveryAt).toBeNull();
    expect(failed.readyAt).not.toBeNull();
    expect(failed.deliveryIssue).toBe("Couldn't deliver: No answer — rang twice");

    // Delivered b, online.
    await page.getByTestId(`button-delivered-${b.code}`).tap();
    await expect(stop(b.code)).toHaveCount(0);
    expect((await row(b.id)).status).toBe("completed");

    // Delivered c with no connection: kept on the phone, sent when back online.
    await page.context().setOffline(true);
    await page.getByTestId(`button-delivered-${c.code}`).tap();
    await expect(page.getByTestId("my-run-message")).toContainText("Saved on this phone");
    await expect(page.getByTestId("my-run-queue")).toContainText(c.code);
    await expect(stop(c.code)).toHaveCount(0);
    expect((await row(c.id)).status).not.toBe("completed");
    await page.context().setOffline(false);
    await expect.poll(async () => (await row(c.id)).status, { timeout: 30_000 }).toBe("completed");
    await expect(page.getByTestId("my-run-queue")).toHaveCount(0);

    await page.context().close();
  });

  test("a cashier cannot open someone else's run", async ({ api, orgId }) => {
    const res = await api.get(`/api/my-run?driver=${encodeURIComponent(DRIVER)}`);
    // `api` is ADMIN: a manager and above may look.
    expect(res.status()).toBe(200);
    const { apiAs } = await import("./fixtures");
    const cashier = await apiAs("CASHIER", orgId);
    const refused = await cashier.get(`/api/my-run?driver=${encodeURIComponent(ROLE_USERS.MANAGER)}`);
    expect(refused.status()).toBe(403);
    await cashier.dispose();
  });
});
