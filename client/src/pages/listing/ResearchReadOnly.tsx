import { useLayoutEffect, useRef, type ReactNode } from "react";
/** Legacy Listing panels share this boundary while their server writes are
 * independently guarded. Navigation, evidence and expansion stay available. */
export default function ResearchReadOnly({
  locked,
  children,
}: {
  locked: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!locked || !root.current) return;
    const originals = new Map<
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | HTMLButtonElement,
      boolean
    >();
    const apply = () =>
      root.current
        ?.querySelectorAll<
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLSelectElement
          | HTMLButtonElement
        >("input,textarea,select,button")
        .forEach(el => {
          const editing =
            el.tagName !== "BUTTON" ||
            /保存|生成|编辑|重新|上传|删除|添加|移除|确认|调整|导入|优化|发送|开始|清空|作为这张图|加入参考|取消等待/.test(
              el.getAttribute("aria-label") || el.textContent || ""
            );
          if (editing) {
            if (!originals.has(el)) originals.set(el, el.disabled);
            el.disabled = true;
          }
        });
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root.current, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const [el, disabled] of originals) el.disabled = disabled;
    };
  }, [locked]);
  return (
    <div
      ref={root}
      className="contents"
      data-research-locked={locked ? "true" : "false"}
    >
      {children}
    </div>
  );
}
