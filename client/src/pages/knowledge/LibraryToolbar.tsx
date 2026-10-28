import type { LibraryFacets } from "@shared/libraryFacets";
import type { ReactNode } from "react";
import { Search, Settings2, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KBScopeToggle, type KBScope } from "@/components/KBScopeToggle";
import type { TagOptions } from "@/hooks/useKBTagOptions";

export type CommonFilters = {
  style: string;
  category: string;
  primaryColor: string;
  accentColor: string;
};
export const EMPTY_COMMON_FILTERS: CommonFilters = {
  style: "",
  category: "",
  primaryColor: "",
  accentColor: "",
};
export function LibrarySearch({
  scope,
  onScope,
  query,
  onQuery,
  placeholder,
}: {
  scope: KBScope;
  onScope: (s: KBScope) => void;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <KBScopeToggle value={scope} onChange={onScope} />
      <div className="relative w-full max-w-lg">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 pl-9"
        />
      </div>
    </div>
  );
}
export function LibraryToolbar({
  children,
  onTags,
  onImport,
  importLabel,
  busy = false,
}: {
  children: ReactNode;
  onTags: () => void;
  onImport: () => void;
  importLabel: string;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-3">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">{children}</div>
      <div className="ml-auto flex shrink-0 gap-2">
        <Button variant="outline" onClick={onTags}>
          <Settings2 className="mr-2 h-4 w-4" />
          标签管理
        </Button>
        <Button disabled={busy} onClick={onImport}>
          <Upload className="mr-2 h-4 w-4" />
          {busy ? "上传中…" : importLabel}
        </Button>
      </div>
    </div>
  );
}
export function LibrarySelect({
  label,
  value,
  onChange,
  options,
  allLabel, counts, total,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (string | { value: string; label: string })[];
  allLabel?: string;
  counts?:Record<string,number>; total?:number;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-10 max-w-[240px] rounded-lg border bg-background px-3 text-sm focus-visible:outline-primary"
    >
      {allLabel && <option value="">{allLabel}{total === undefined ? "" : `（${total}）`}</option>}
      {options.map(option => {
        const o =
          typeof option === "string"
            ? { value: option, label: option }
            : option;
        return (
          <option key={o.value} value={o.value}>
            {o.label}{counts ? `（${counts[o.value] || 0}）` : ""}
          </option>
        );
      })}
    </select>
  );
}
export function CommonTagFilters({
  value,
  onChange,
  tags, facets,
}: {
  value: CommonFilters;
  onChange: (v: CommonFilters) => void;
  tags: TagOptions;
  facets?:LibraryFacets;
}) {
  return (
    <>
      {(
        [
          { key: "style", label: "风格", options: tags.styleOptions },
          { key: "category", label: "类目", options: tags.categoryOptions },
          { key: "primaryColor", label: "主色", options: tags.colorOptions },
          {
            key: "accentColor",
            label: "提亮色",
            options: [
              ...tags.colorOptions,
              { value: "__none", label: "无明显提亮色" },
            ],
          },
        ] as const
      ).map(f => (
        <LibrarySelect
          key={f.key}
          counts={facets?.counts[f.key]} total={facets?.totals[f.key]}
          label={`${f.label}筛选`}
          allLabel={`全部${f.label}`}
          options={f.options}
          value={value[f.key]}
          onChange={v => onChange({ ...value, [f.key]: v })}
        />
      ))}
    </>
  );
}
export function LibraryPagination({
  page,
  hasMore,
  busy,
  onPage,
  total,
}: {
  page: number;
  hasMore: boolean;
  busy?: boolean;
  onPage: (n: number) => void;
  total?: number;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1 || busy}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </Button>
      <span className="text-sm text-muted-foreground">
        第 {page}
        {total ? ` / ${total}` : ""} 页
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasMore || busy}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}
export function groupLibraryItems<T>(
  items: T[],
  value: (item: T) => string | null | undefined,
  none = false
) {
  if (none) return [{ name: "", items }];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = value(item) || "待设置";
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}
