import { RESEARCH_EXTENSION_LIBRARY } from "./origin.mjs";
declare const chrome: any;
const status = document.getElementById("status")!,
  login = document.getElementById("login") as HTMLButtonElement,
  logout = document.getElementById("logout") as HTMLButtonElement,
  dialog = document.getElementById("login-dialog") as HTMLDialogElement,
  form = document.getElementById("login-form") as HTMLFormElement,
  identifier = document.getElementById("identifier") as HTMLInputElement,
  password = document.getElementById("password") as HTMLInputElement,
  error = document.getElementById("login-error")!,
  submit = document.getElementById("submit") as HTMLButtonElement;
async function send(type: string, data: Record<string, unknown> = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) throw new Error(result?.error || "插件暂时无法连接");
  return result;
}
function show(result: any) {
  status.textContent = result.connected
    ? `已登录：${result.name}。${result.expiresAt ? "有效期至 " + new Date(result.expiresAt).toLocaleDateString("zh-CN") + "。" : ""}${result.notice || "登录保留30天。"}`
    : result.notice ||
      (result.pending
        ? "旧版连接待确认，也可直接登录。"
        : "尚未登录，请使用系统账号登录。");
  login.hidden = !!result.connected;
  logout.hidden = !result.connected;
}
async function poll() {
  try {
    show(await send("poll"));
  } catch (e) {
    status.textContent = (e as Error).message;
  }
}
login.addEventListener("click", () => {
  error.textContent = "";
  dialog.showModal();
  identifier.focus();
});
document
  .getElementById("cancel")!
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  password.value = "";
});
form.addEventListener("submit", async e => {
  e.preventDefault();
  submit.disabled = true;
  error.textContent = "";
  try {
    const result = await send("login", {
      identifier: identifier.value,
      password: password.value,
    });
    password.value = "";
    dialog.close();
    show(result);
  } catch (e) {
    error.textContent = (e as Error).message;
    password.value = "";
    password.focus();
  } finally {
    submit.disabled = false;
  }
});
document.getElementById("check")!.addEventListener("click", () => void poll());
logout.addEventListener("click", async () => {
  try {
    await send("logout");
  } catch (e) {
    status.textContent = (e as Error).message;
  }
  await poll();
});
document
  .getElementById("library")!
  .addEventListener("click", () =>
    chrome.tabs.create({ url: RESEARCH_EXTENSION_LIBRARY })
  );
void poll();
