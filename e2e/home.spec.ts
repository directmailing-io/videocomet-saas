import { test, expect } from "@playwright/test";

test.describe("Public pages", () => {
  test("Landing page zeigt VIDEOCOMET", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("VIDEOCOMET").first()).toBeVisible();
  });

  test("User-Login zeigt 'Willkommen zurück'", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Willkommen zurück")).toBeVisible();
  });

  test("Admin-Login zeigt 'Administrator' Badge", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByText("Administrator").first()).toBeVisible();
  });
});
