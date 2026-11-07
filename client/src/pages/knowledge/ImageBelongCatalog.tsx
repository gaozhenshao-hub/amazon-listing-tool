import {
  AMAZON_MODULE_CATALOG,
  IMAGE_FAMILIES,
  moduleSpecLabel,
} from "@shared/imageModuleSpecs";
export default function ImageBelongCatalog() {
  return (
    <div className="space-y-5" aria-label="图片归属官方模块目录">
      <p className="text-sm text-muted-foreground">
        归属均为两级。新图片大纲默认高级 A+；历史素材未确认版本的保留原归属。
      </p>
      {IMAGE_FAMILIES.map(family => (
        <section key={family} className="space-y-3">
          <h3 className="flex justify-between border-b pb-2 font-semibold">
            <span>{family}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {AMAZON_MODULE_CATALOG.filter(s => s.family === family).length}{" "}
              个子类
            </span>
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {AMAZON_MODULE_CATALOG.filter(s => s.family === family).map(
              spec => (
                <article
                  key={spec.officialType}
                  className="rounded-xl border p-3"
                >
                  <h4 className="text-sm font-medium">{spec.name}</h4>
                  <p className="mt-1 break-words text-[11px] text-muted-foreground">
                    {spec.officialName}
                  </p>
                  <p className="mt-2 text-xs">{moduleSpecLabel(spec)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {spec.media === "text"
                      ? "文字模块"
                      : spec.min === spec.max
                        ? `${spec.defaultCount} 个媒体格子`
                        : `${spec.min}–${spec.max} 个媒体格子`}{" "}
                    · {spec.guidance}
                  </p>
                  {spec.source && (
                    <a
                      href={spec.source}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-primary underline"
                    >
                      亚马逊官方规格
                    </a>
                  )}
                </article>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
