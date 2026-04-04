import { expect, test } from "@playwright/test";

async function joinRoom(page: import("@playwright/test").Page) {
  const nick = `smoke-${Date.now()}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cascad Rooms" })).toBeVisible();

  await page.getByLabel("Nickname").fill(nick);
  await page.getByRole("button", { name: "Login as Guest" }).click();
  await expect(page.getByText(`Logged in as ${nick}`)).toBeVisible();

  await page.getByLabel("Room name").fill(`Smoke ${Date.now()}`);
  await page.getByRole("button", { name: "Create Room + Invite" }).click();
  await expect(page.getByText("Invite URL", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Join Room" }).click();
  await expect(page.getByRole("heading", { name: "Streams" })).toBeVisible();
}

test("room smoke: join + settings + panel tabs", async ({ page }) => {
  await joinRoom(page);

  await page.getByRole("button", { name: "Room settings" }).click();
  await expect(page.getByText("Room Settings")).toBeVisible();
  await expect(page.getByText("Microphone Processing")).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page.getByRole("heading", { name: "Streams" })).toBeVisible();

  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("Chat (soon)")).toBeVisible();

  await page.getByRole("tab", { name: "Participants" }).click();
  await expect(page.getByText("Participants (")).toBeVisible();
});

test("room smoke: layout modes and theater hide side panel", async ({ page }) => {
  await joinRoom(page);

  await page.getByRole("button", { name: "Focus layout" }).click();
  await expect(page.getByText("Focus", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Theater mode" }).click();
  await expect(page.getByText("Theater (focus)", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Participants" })).toHaveCount(0);

  await page.getByRole("button", { name: "Grid layout" }).click();
  await expect(page.getByText("Grid", { exact: true })).toBeVisible();
});
