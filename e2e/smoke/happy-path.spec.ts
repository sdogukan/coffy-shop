import { expect, test } from "@playwright/test";
import { expectHydrated, smokeAdminCredentials } from "./support.ts";

test("an order goes from the menu to Hazır on the customer's tracking page", async ({ page }) => {
  const currentStep = page.getByRole("list", { name: "Sipariş durumu" }).locator('[aria-current="step"]');

  await test.step("add an espresso to the cart from the menu", async () => {
    await page.goto("/");
    await expectHydrated(page);
    const espresso = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Espresso", exact: true }) });
    await espresso.getByRole("button", { name: "Sepete ekle" }).click();
    await expect(espresso.getByRole("status")).toHaveText("Sepete eklendi.");
    await expect(page.getByLabel("1 ürün")).toBeVisible();
  });

  await test.step("the cart shows the espresso and leads to checkout", async () => {
    await page.goto("/sepet");
    await expect(page.getByRole("heading", { name: "Espresso", exact: true })).toBeVisible();
    await expect(page.getByText("Adet: 1", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Siparişi tamamla" }).click();
    await expect(page).toHaveURL(/\/siparis-ver$/);
  });

  let reference = "";
  let trackingUrl = "";
  await test.step("place the order and read its reference and tracking link", async () => {
    await page.getByLabel("Adınız").fill("Smoke Müşteri");
    await page.getByRole("button", { name: "Siparişi ver" }).click();
    await expect(page.getByRole("heading", { name: "Siparişiniz alındı" })).toBeVisible();
    reference = ((await page.locator(".order-confirmation strong").textContent()) ?? "").trim();
    trackingUrl = (await page.locator(".tracking-link a").getAttribute("href")) ?? "";
    expect(reference).not.toBe("");
    expect(trackingUrl).toMatch(/\/siparis\/[A-Za-z0-9_-]{43}$/);
  });

  await test.step("the tracking page starts at Yeni", async () => {
    await page.goto(trackingUrl);
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    await expect(currentStep).toHaveText("Yeni");
  });

  await test.step("the admin signs in and opens the order by its reference", async () => {
    const { username, password } = smokeAdminCredentials();
    await page.goto("/yonetim/giris");
    await expectHydrated(page);
    await page.getByLabel("Kullanıcı adı").fill(username);
    await page.getByLabel("Şifre").fill(password);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page).toHaveURL(/\/yonetim\/urunler$/);
    await page.getByRole("link", { name: "Siparişler", exact: true }).click();
    await expect(page).toHaveURL(/\/yonetim\/siparisler$/);
    // Other scenarios create orders in the same database: find this one by
    // its reference, never by position.
    await page.getByRole("link", { name: reference, exact: true }).click();
    await expect(page.getByRole("heading", { name: `Sipariş ${reference}`, exact: true })).toBeVisible();
    await expect(page.getByText("Durum: Yeni", { exact: true })).toBeVisible();
  });

  await test.step("the admin advances the order Yeni -> Hazırlanıyor -> Hazır", async () => {
    await page.getByRole("button", { name: "Hazırlanıyor olarak işaretle", exact: true }).click();
    await expect(page.getByText("Durum: Hazırlanıyor", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Hazır olarak işaretle", exact: true }).click();
    await expect(page.getByText("Durum: Hazır", { exact: true })).toBeVisible();
  });

  await test.step("the customer's tracking page shows Hazır as the current step", async () => {
    await page.goto(trackingUrl);
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    await expect(currentStep).toHaveText("Hazır");
    await expect(page.getByText("Durum: Hazır", { exact: true })).toBeVisible();
  });
});
