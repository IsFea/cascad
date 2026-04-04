import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

async function openAuth(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cascad" })).toBeVisible();
}

async function loginAsAdminApi(request: import("@playwright/test").APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    data: {
      username: "admin",
      password: "admin12345",
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { appToken: string };
}

async function approveUserApi(
  request: import("@playwright/test").APIRequestContext,
  adminToken: string,
  username: string,
) {
  const list = await request.get("/api/admin/approvals", {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  expect(list.ok()).toBeTruthy();
  const payload = (await list.json()) as {
    users: Array<{ userId: string; username: string }>;
  };
  const pending = payload.users.find((item) => item.username === username);
  expect(pending).toBeTruthy();

  const approve = await request.post(`/api/admin/approvals/${pending!.userId}/approve`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  expect(approve.status()).toBe(204);
}

async function isVisible(locator: Locator) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

test("auth flow: register -> pending screen", async ({ page }) => {
  const username = `pending_${Date.now()}`;
  const password = `${username}12345`;

  await openAuth(page);
  await page.getByRole("tab", { name: "Register" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/^Password/i).first().fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText("ожидайте аппрув администратора")).toBeVisible();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/^Password/i).first().fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  const russianPending = page.getByText("Админ должен подтвердить доступ");
  const englishPending = page.getByText("Account is waiting for admin approval.");
  await expect(russianPending.or(englishPending)).toBeVisible();
});

test("workspace flow: approved user can login and send text message", async ({ page, request }) => {
  const username = `approved_${Date.now()}`;
  const password = `${username}12345`;

  await openAuth(page);
  await page.getByRole("tab", { name: "Register" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/^Password/i).first().fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText("зарегистрирован")).toBeVisible();

  const admin = await loginAsAdminApi(request);
  await approveUserApi(request, admin.appToken, username);

  await page.getByRole("tab", { name: "Login" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/^Password/i).first().fill(password);
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByText("Cascad Workspace")).toBeVisible();
  await page.getByPlaceholder("Message with @mentions and emoji").fill("hello @admin 😎");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("hello").first()).toBeVisible();
});

test("voice flow: double click connect and use left voice controls", async ({ page, request }) => {
  const username = `voice_${Date.now()}`;
  const password = `${username}12345`;

  await openAuth(page);
  await page.getByRole("tab", { name: "Register" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/^Password/i).first().fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText("зарегистрирован")).toBeVisible();

  const admin = await loginAsAdminApi(request);
  await approveUserApi(request, admin.appToken, username);

  await page.getByRole("tab", { name: "Login" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/^Password/i).first().fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Cascad Workspace")).toBeVisible();

  const userToken = await page.evaluate(() => localStorage.getItem("cascad_app_token"));
  expect(userToken).toBeTruthy();

  const workspace = await request.get("/api/workspace", {
    headers: {
      Authorization: `Bearer ${userToken!}`,
    },
  });
  expect(workspace.ok()).toBeTruthy();
  const workspacePayload = (await workspace.json()) as {
    channels: Array<{ id: string; name: string; type: "Text" | "Voice" }>;
  };
  const voice = workspacePayload.channels.find((channel) => channel.type === "Voice");
  expect(voice).toBeTruthy();

  const voiceButton = page.getByRole("button", { name: new RegExp(voice!.name, "i") }).first();
  await voiceButton.dblclick();

  const voiceOnlineLabel = page.getByText("Voice online");
  const voiceConnectedLabel = page.getByText("Voice connected");
  await expect(voiceOnlineLabel.or(voiceConnectedLabel)).toBeVisible();

  await page.getByRole("button", { name: "Mute" }).click();

  if (await isVisible(page.getByRole("button", { name: "Leave voice" }))) {
    await page.getByRole("button", { name: "Leave voice" }).click();
  }
});

test("admin can create channels from plus buttons", async ({ page }) => {
  await openAuth(page);
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel(/^Password/i).first().fill("admin12345");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByText("Cascad Workspace")).toBeVisible();

  const textName = `text_${Date.now()}`;
  const voiceName = `voice_${Date.now()}`;

  await page.getByRole("button", { name: "Create text channel" }).dispatchEvent("click");
  const textDialog = page.getByRole("dialog").first();
  await textDialog.getByLabel("Channel name").fill(textName);
  await textDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(textName, "i") })).toBeVisible();

  await page.getByRole("button", { name: "Create voice channel" }).dispatchEvent("click");
  const voiceDialog = page.getByRole("dialog").first();
  await voiceDialog.getByLabel("Channel name").fill(voiceName);
  await voiceDialog.getByLabel("Max participants").fill("6");
  await voiceDialog.getByLabel("Max concurrent streams").fill("2");
  await voiceDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(voiceName, "i") })).toBeVisible();
  await expect(page.getByText("(0/6)").first()).toBeVisible();
});
