import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("Account is waiting for admin approval.")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "# general" })).toBeVisible();
  await page.getByPlaceholder("Message with @mentions and emoji").fill("hello @admin 😎");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("hello").first()).toBeVisible();
});

test("voice flow: connect and toggle mute/deafen controls", async ({ page, request }) => {
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
    channels: Array<{ id: string; type: "Text" | "Voice" }>;
  };
  const voice = workspacePayload.channels.find((channel) => channel.type === "Voice");
  expect(voice).toBeTruthy();

  const connect = await request.post("/api/voice/connect", {
    headers: {
      Authorization: `Bearer ${userToken!}`,
    },
    data: {
      channelId: voice!.id,
    },
  });
  expect(connect.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true }).first()).toBeEnabled();

  await page.getByRole("button", { name: "Mute", exact: true }).first().click();
  await page.getByRole("button", { name: "Deafen", exact: true }).first().click();

  await page.getByRole("button", { name: "Disconnect", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Connect", exact: true }).first()).toBeEnabled();
});
