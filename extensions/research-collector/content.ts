import { visibleResearchPage } from "./core";
declare const chrome: any;
const ID = "xingqi-research-collector";
let lastAddress = "",
  timer: ReturnType<typeof setTimeout> | undefined;
function render() {
  const page = visibleResearchPage(document, location.href);
  if (!page) {
    document.getElementById(ID)?.remove();
    lastAddress = "";
    return;
  }
  const address = page.data.url;
  if (document.getElementById(ID) && lastAddress === address) return;
  document.getElementById(ID)?.remove();
  lastAddress = address;
  const host = document.createElement("span");
  host.id = ID;
  host.style.cssText = page.target
    ? "display:inline-flex;vertical-align:middle;margin-left:16px;"
    : "position:fixed;right:24px;top:110px;z-index:2147483000;";
  const root = host.attachShadow({ mode: "closed" }),
    style = document.createElement("style");
  style.textContent =
    ":host{font:14px system-ui,sans-serif}button{border:1px solid #8c371b;border-radius:9px;background:#8c371b;color:white;padding:10px 15px;cursor:pointer;font:600 14px system-ui,sans-serif;box-shadow:0 2px 7px #0002}button:disabled{opacity:.7;cursor:default}p{position:absolute;max-width:300px;margin:8px 0;padding:10px;background:#fff;color:#333;border:1px solid #ddd;border-radius:8px;box-shadow:0 3px 12px #0002;font:13px/1.5 system-ui,sans-serif}";
  const button = document.createElement("button"),
    notice = document.createElement("p");
  notice.hidden = true;
  const normal =
      page.data.kind === "product" ? "＋ 加入产品库" : "☆ 收藏该店铺",
    done = page.data.kind === "product" ? "✓ 已加入产品库" : "✓ 已收藏店铺";
  button.textContent = normal;
  button.addEventListener("click", async () => {
    button.disabled = true;
    notice.hidden = true;
    try {
      const current = visibleResearchPage(document, location.href);
      if (!current || current.data.url !== address)
        throw new Error("页面已变化，请重新收藏");
      const result = await chrome.runtime.sendMessage({
        type: "collect",
        data: current.data,
      });
      if (!result?.ok) throw new Error(result?.error || "收藏暂未完成");
      button.textContent = done;
      notice.textContent = result.message;
      notice.hidden = false;
    } catch (e) {
      notice.textContent =
        e instanceof Error ? e.message : "收藏暂未完成，请重试";
      notice.hidden = false;
      button.disabled = false;
    }
  });
  root.append(style, button, notice);
  (page.target || document.body).append(host);
  chrome.runtime
    .sendMessage({ type: "lookup", data: page.data })
    .then((result: any) => {
      if (result?.ok && result.collected) {
        button.textContent = done;
        button.disabled = true;
      }
    })
    .catch(() => {});
}
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(render, 350);
};
render();
new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
window.addEventListener("popstate", schedule);
