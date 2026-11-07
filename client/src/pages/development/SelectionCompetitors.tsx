import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  chartPickParents,
  pickAnalysis,
  summarizePickRows,
  type PickRow,
} from "@shared/productSelectionAnalysis";
import type { PickTag } from "@shared/productSelection";
import { fmt } from "./SelectionProfit";

type Analysis = ReturnType<typeof pickAnalysis>;
type Value = string | number | string[] | null;
type Column = {
  key: string;
  label: string;
  value: (row: PickRow) => Value;
  width?: number;
  decimals?: number;
};
const PALETTE = [
  "#9a3d19",
  "#27666e",
  "#477e42",
  "#9c6b15",
  "#7a4e8e",
  "#4266a0",
  "#b45372",
  "#437361",
];
const badgeColors: Record<string, string> = {
  BS: "bg-blue-100",
  CPF: "bg-green-100",
  AC: "bg-cyan-100",
  NR: "bg-yellow-100",
  "A+": "bg-orange-100",
  视频: "bg-cyan-100",
  品牌故事: "bg-indigo-100",
};
const options = {
  salesLevel: "销量评级",
  brand: "品牌",
  priceLevel: "售价评级",
  age: "上架时长",
};
const values = (value: Value) =>
  Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
const asText = (value: Value) => values(value).join(" · ");
const compare = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), "zh-CN", { numeric: true });

function size(sides: PickRow["packageCm"], kg: number | null) {
  return [
    sides
      ? sides.map(x => fmt(x, 2)).join(" × ") +
        " cm（" +
        sides.map(x => fmt(x / 2.54, 2)).join(" × ") +
        " in）"
      : "",
    kg === null ? "" : fmt(kg, 2) + " kg（" + fmt(kg / 0.45359237, 2) + " lb）",
  ]
    .filter(Boolean)
    .join(" / ");
}

function columns(tags: Map<string, PickTag>): Column[] {
  return [
    { key: "number", label: "序号", value: r => r.number },
    { key: "parent", label: "父 ASIN", value: r => r.parentAsin },
    { key: "parentSales", label: "父体销量", value: r => r.monthSales },
    {
      key: "trend",
      label: "销量趋势",
      value: r => [...r.trend].reverse().find(x => x !== null) ?? null,
    },
    { key: "salesLevel", label: "销量评级", value: r => r.salesLevel },
    { key: "brand", label: "品牌", value: r => r.parentBrand },
    { key: "rank", label: "大类排名", value: r => r.rank },
    { key: "asin", label: "子 ASIN", value: r => r.asin },
    { key: "childSales", label: "子体销量", value: r => r.childSales },
    {
      key: "spec",
      label: "变体规格 / SKU",
      value: r => [r.sku, r.spec].filter(Boolean).join(" / "),
      width: 200,
    },
    {
      key: "image",
      label: "产品图片",
      value: r => (r.image ? "有图" : "无图"),
    },
    {
      key: "tags",
      label: "自定义标签",
      value: r => r.tagIds.flatMap(id => tags.get(id)?.name ?? []),
      width: 150,
    },
    { key: "price", label: "售价（USD）", value: r => r.price, decimals: 2 },
    { key: "priceLevel", label: "售价评级", value: r => r.priceLevel },
    { key: "rating", label: "评分", value: r => r.rating, decimals: 2 },
    { key: "reviews", label: "评论数量", value: r => r.reviews },
    { key: "listedOn", label: "上架时间", value: r => r.listedOn },
    { key: "age", label: "上架时长", value: r => r.age },
    {
      key: "fulfillment",
      label: "国家配送",
      value: r => [r.sellerCountry, r.fulfillment].filter(Boolean).join(" / "),
    },
    { key: "fba", label: "FBA 费用", value: r => r.fbaFee, decimals: 2 },
    {
      key: "package",
      label: "包装尺寸重量",
      value: r => size(r.packageCm, r.packageKg),
      width: 220,
    },
    {
      key: "product",
      label: "产品尺寸重量",
      value: r => size(r.productCm, r.productKg),
      width: 220,
    },
    { key: "tier", label: "尺寸分段", value: r => r.sizeTier },
    { key: "badges", label: "产品标签", value: r => r.badges },
    { key: "listing", label: "Listing 完善度", value: r => r.listing },
  ];
}

function BadgeList({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? (
    <div className="flex flex-wrap gap-1">
      {items.map((value, i) => (
        <span
          key={value + i}
          className={
            "whitespace-nowrap rounded-full px-1.5 py-0.5 " +
            (badgeColors[value]
              ? badgeColors[value] + " text-slate-900"
              : "bg-muted")
          }
        >
          {value}
        </span>
      ))}
    </div>
  ) : (
    empty
  );
}

function Sparkline({ trend }: { trend: PickRow["trend"] }) {
  const max = Math.max(1, ...trend.map(x => x ?? 0));
  const points = trend.flatMap((value, i) =>
    value === null
      ? []
      : [
          {
            x: 3 + i * 7,
            y: 27 - (value * 23) / max,
            draw: i > 0 && trend[i - 1] !== null,
          },
        ]
  );
  return points.length ? (
    <svg viewBox="0 0 85 30" className="h-8 w-[85px] text-primary" aria-hidden>
      <path
        d={points
          .map(({ x, y, draw }) => (draw ? "L" : "M") + x + " " + y)
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      {points.map(({ x, y }) => (
        <circle key={x} cx={x} cy={y} r={1.6} fill="currentColor" />
      ))}
    </svg>
  ) : (
    <span className="text-muted-foreground">无趋势</span>
  );
}

function SalesLine({
  points,
}: {
  points: { month: string; total: number | null; known?: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={points}
        margin={{ top: 14, right: 10, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" fontSize={11} />
        <YAxis width={48} fontSize={11} />
        <Tooltip
          formatter={(value, _, item) => [
            fmt(Number(value)) +
              " 件" +
              (item.payload?.known == null
                ? ""
                : "（" + item.payload.known + " 个父体）"),
            "销量",
          ]}
        />
        <Line
          dataKey="total"
          stroke={PALETTE[0]}
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
function MarketCharts({ rows, months }: { rows: PickRow[]; months: string[] }) {
  const charts = useMemo(() => chartPickParents(rows, months), [rows, months]);
  const sum = charts.brands.reduce((total, brand) => total + brand.sales, 0);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border p-3">
        <h3 className="font-medium">竞品合计月销量趋势</h3>
        <p className="text-xs text-muted-foreground">
          每月按父体去重。缺失月份留空。
        </p>
        {charts.trend.some(x => x.known) ? (
          <SalesLine points={charts.trend} />
        ) : (
          <p className="py-8 text-sm text-muted-foreground">
            暂无匹配的历史销量
          </p>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer">查看逐月数据</summary>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {charts.trend.map(p => (
              <span key={p.month}>
                {p.month} · {fmt(p.total)}（{p.known}/{charts.parentCount}）
              </span>
            ))}
          </div>
        </details>
      </div>
      <div className="rounded-lg border p-3">
        <h3 className="font-medium">品牌销量占比</h3>
        <p className="text-xs text-muted-foreground">
          按搜索表已知父体月销量。{charts.missing} 个父体销量缺失。
        </p>
        {sum > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Tooltip />
                <Pie
                  data={charts.brands}
                  nameKey="brand"
                  dataKey="sales"
                  outerRadius={80}
                  isAnimationActive={false}
                >
                  {charts.brands.map((brand, i) => (
                    <Cell
                      key={brand.brand}
                      fill={PALETTE[i % PALETTE.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto text-xs">
              {charts.brands.map((brand, i) => (
                <span key={brand.brand}>
                  <span style={{ color: PALETTE[i % PALETTE.length] }}>●</span>{" "}
                  {brand.brand} {fmt(brand.sales)}（
                  {fmt((brand.sales / sum) * 100, 1)}%）
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="py-8 text-sm text-muted-foreground">
            暂无可计算占比的销量
          </p>
        )}
      </div>
    </div>
  );
}

export function SelectionCompetitors({
  analysis,
  tags,
  editable,
  toolbar,
  onEditTags,
  onEditSales,
}: {
  analysis: Analysis;
  tags: PickTag[];
  editable: boolean;
  toolbar: ReactNode;
  onEditTags: (row: PickRow) => void;
  onEditSales: (row: PickRow) => void;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; direction: number } | null>(
    null
  );
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [trend, setTrend] = useState<PickRow | null>(null);
  const tagMap = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags]);
  const headings = useMemo(() => columns(tagMap), [tagMap]);
  const parentGroup = group === "salesLevel" || group === "brand";
  const merge =
    (!group || parentGroup) &&
    !headings.slice(6).some(col => filters[col.key] || sort?.key === col.key);
  const rows = useMemo(
    () =>
      analysis.rows
        .filter(row =>
          headings.every(col => {
            const filter = filters[col.key],
              cell = col.value(row);
            if (!filter) return true;
            if (filter === "@missing") return !values(cell).length;
            if (filter.startsWith("="))
              return values(cell).some(
                item => String(item) === filter.slice(1)
              );
            return asText(cell).toLowerCase().includes(filter.toLowerCase());
          })
        )
        .sort((a, b) => {
          const col = headings.find(col => col.key === sort?.key);
          if (col && sort) {
            const left = col.value(a),
              right = col.value(b);
            const x = values(left),
              y = values(right);
            const order =
              !x.length || !y.length
                ? Number(!x.length) - Number(!y.length)
                : sort.direction *
                  compare(
                    Array.isArray(left) ? asText(left) : x[0],
                    Array.isArray(right) ? asText(right) : y[0]
                  );
            if (order) return order;
          }
          return a.number - b.number || a.asin.localeCompare(b.asin);
        }),
    [analysis.rows, headings, filters, sort]
  );
  const groups = useMemo(() => {
    if (!group) return [["", rows]] as [string, PickRow[]][];
    const collected = new Map<string, PickRow[]>();
    const col = headings.find(col => col.key === group);
    for (const row of rows) {
      const names = group.startsWith("tag/")
        ? row.tagIds.flatMap(id => {
            const tag = tagMap.get(id);
            return tag?.dimension === group.slice(4) ? [tag.name] : [];
          })
        : [asText(col?.value(row) ?? null)].filter(Boolean);
      for (const name of new Set(names.length ? names : ["未分组"])) {
        const current = collected.get(name) ?? [];
        current.push(row);
        collected.set(name, current);
      }
    }
    const order =
      group === "salesLevel"
        ? ["头部", "中上", "中下", "尾部", "待评级"]
        : group === "priceLevel"
          ? ["低价", "中价", "高价", "待评级"]
          : group === "age"
            ? ["纯新", "新", "半新", "老品", "很老", "未知"]
            : null;
    return [...collected].sort(([a], [b]) =>
      order ? order.indexOf(a) - order.indexOf(b) : compare(a, b)
    );
  }, [group, headings, rows, tagMap]);
  const pageSize = 100,
    total = groups.reduce((sum, [, items]) => sum + items.length, 0);
  const maxPage = Math.max(1, Math.ceil(total / pageSize)),
    active = Math.min(page, maxPage);
  let cursor = 0;
  const market = summarizePickRows(rows, "parent");
  const edit = (label: string, onClick: () => void) =>
    editable && (
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        title={label}
        aria-label={label}
        onClick={onClick}
      >
        <Pencil className="size-3" />
      </Button>
    );

  function cell(col: Column, row: PickRow) {
    const value = col.value(row);
    if (col.key === "trend")
      return (
        <button
          type="button"
          className="rounded focus-visible:ring"
          aria-label={"查看 " + row.parentAsin + " 的销量趋势"}
          onClick={() => setTrend(row)}
        >
          <Sparkline trend={row.trend} />
        </button>
      );
    if (col.key === "image")
      return row.image ? (
        <img
          className="h-12 w-12 rounded bg-white object-contain"
          loading="lazy"
          src={row.image}
          alt={row.title || row.asin}
          referrerPolicy="no-referrer"
        />
      ) : (
        "—"
      );
    if (col.key === "badges" || col.key === "listing")
      return <BadgeList items={value as string[]} empty="无" />;
    if (col.key === "tags")
      return (
        <div className="flex items-center gap-1">
          <BadgeList items={value as string[]} empty="—" />
          {edit("编辑 " + row.asin + " 的标签", () => onEditTags(row))}
        </div>
      );
    if (col.key === "childSales")
      return (
        <div className="flex items-center gap-1">
          <span
            title={row.manualSales ? "人工填写" : "导入数据"}
            className={row.manualSales ? "bg-amber-100 text-amber-900" : ""}
          >
            {fmt(row.childSales)}
          </span>
          {edit("补填 " + row.asin + " 的销量", () => onEditSales(row))}
        </div>
      );
    if (col.key === "asin") return <span title={row.title}>{row.asin}</span>;
    return typeof value === "number"
      ? fmt(value, col.decimals ?? 0)
      : value || "—";
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">产品竞品分析表</h2>
      {toolbar}
      {analysis.rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              分组
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={group}
                onChange={e => {
                  setGroup(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">不分组</option>
                {Object.entries(options).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
                {[...new Set(tags.map(tag => tag.dimension))].map(d => (
                  <option key={d} value={"tag/" + d}>
                    自定义标签 · {d}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters({});
                setSort(null);
                setGroup("");
                setPage(1);
              }}
            >
              清除筛选、排序与分组
            </Button>
            <span className="ml-auto text-muted-foreground">
              {rows.length} 个子体 · {market.parents} 个父体 · 父体月销量{" "}
              {fmt(market.sales.total)} 件（缺失 {market.sales.missing} 个）
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            评级按完整导入样本计算。子体筛选或排序时每条保留父体信息。父体统计去重，子体分组只合计已知子体销量。组内均值括号显示有效子体数。
          </p>
          <div className="max-h-[560px] overflow-auto rounded-lg border">
            <table className="min-w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {headings.map(col => (
                    <th
                      className="whitespace-nowrap border-b border-r px-2 py-1.5 text-left"
                      style={{ minWidth: col.width ?? 95 }}
                      key={col.key}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        <Popover
                          open={openFilter === col.key}
                          onOpenChange={open =>
                            setOpenFilter(open ? col.key : null)
                          }
                        >
                          <PopoverTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className={
                                "size-7 " +
                                (filters[col.key] || sort?.key === col.key
                                  ? "bg-primary/10 text-primary"
                                  : "")
                              }
                              aria-label={col.label + "筛选与排序"}
                            >
                              <ChevronDown className="size-3" />
                            </Button>
                          </PopoverTrigger>
                          {openFilter === col.key && (
                            <PopoverContent className="w-64 space-y-2 text-sm">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSort({ key: col.key, direction: 1 });
                                    setPage(1);
                                  }}
                                >
                                  升序
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSort({ key: col.key, direction: -1 });
                                    setPage(1);
                                  }}
                                >
                                  降序
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setSort(null)}
                                >
                                  清除排序
                                </Button>
                              </div>
                              <Input
                                placeholder="筛选包含的内容"
                                aria-label={col.label + "搜索"}
                                value={
                                  /^(=|@missing)/.test(filters[col.key] ?? "")
                                    ? ""
                                    : (filters[col.key] ?? "")
                                }
                                onChange={e => {
                                  setFilters({
                                    ...filters,
                                    [col.key]: e.target.value,
                                  });
                                  setPage(1);
                                }}
                              />
                              <select
                                className="w-full rounded-md border bg-background p-2"
                                aria-label={col.label + "精确筛选"}
                                value={
                                  /^(=|@missing)/.test(filters[col.key] ?? "")
                                    ? filters[col.key]
                                    : ""
                                }
                                onChange={e => {
                                  setFilters({
                                    ...filters,
                                    [col.key]: e.target.value,
                                  });
                                  setPage(1);
                                }}
                              >
                                <option value="">全部</option>
                                <option value="@missing">空值</option>
                                {[
                                  ...new Set(
                                    analysis.rows
                                      .flatMap(r => values(col.value(r)))
                                      .map(String)
                                  ),
                                ]
                                  .sort(compare)
                                  .map(x => (
                                    <option key={x} value={"=" + x}>
                                      {x}
                                    </option>
                                  ))}
                              </select>
                            </PopoverContent>
                          )}
                        </Popover>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([name, items]) => {
                  const start = cursor;
                  cursor += items.length;
                  const visible = items.slice(
                    Math.max(0, (active - 1) * pageSize - start),
                    Math.max(0, active * pageSize - start)
                  );
                  if (!visible.length) return null;
                  const stats = group
                    ? summarizePickRows(items, parentGroup ? "parent" : "child")
                    : null;
                  return (
                    <Fragment key={name}>
                      {stats && (
                        <tr className="bg-primary/10 font-semibold">
                          <td
                            colSpan={headings.length}
                            className="border-b p-2"
                          >
                            {name} · {parentGroup ? "父体" : "子体"}销量{" "}
                            {fmt(stats.sales.total)}（缺失 {stats.sales.missing}
                            ） · 平均售价 USD {fmt(stats.price.value, 2)}（
                            {stats.price.known}） · 平均评论数{" "}
                            {fmt(stats.reviews.value, 1)}（{stats.reviews.known}
                            ） · 平均评分 {fmt(stats.rating.value, 2)}（
                            {stats.rating.known}）
                          </td>
                        </tr>
                      )}
                      {visible.map((row, i) => {
                        const covered =
                          merge &&
                          visible[i - 1]?.parentAsin === row.parentAsin;
                        let span = 1;
                        if (merge && !covered)
                          while (
                            visible[i + span]?.parentAsin === row.parentAsin
                          )
                            span++;
                        return (
                          <tr key={row.asin} className="hover:bg-muted/40">
                            {headings.map((col, index) =>
                              index < 6 && covered ? null : (
                                <td
                                  key={col.key}
                                  rowSpan={index < 6 ? span : undefined}
                                  className="border-b border-r px-2 py-2 align-top"
                                >
                                  {cell(col, row)}
                                </td>
                              )
                            )}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td
                      colSpan={headings.length}
                      className="p-5 text-muted-foreground"
                    >
                      没有符合筛选的竞品
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {maxPage > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={active <= 1}
                onClick={() => setPage(active - 1)}
              >
                上一页
              </Button>
              <span className="self-center text-sm">
                {active} / {maxPage}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={active >= maxPage}
                onClick={() => setPage(active + 1)}
              >
                下一页
              </Button>
            </div>
          )}
          <MarketCharts rows={rows} months={analysis.months} />
        </>
      )}
      {trend && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setTrend(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{trend.parentAsin} · 近 12 个完整月销量</DialogTitle>
            </DialogHeader>
            <SalesLine
              points={analysis.months.map((month, i) => ({
                month,
                total: trend.trend[i],
              }))}
            />
            <div className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-4">
              {analysis.months.map((month, i) => (
                <div className="rounded-md bg-muted p-2" key={month}>
                  {month}
                  <strong className="block">
                    {fmt(trend.trend[i])}
                    {trend.trend[i] !== null ? " 件" : ""}
                  </strong>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              同一父体同月取所有匹配子 ASIN 记录中的最大值。
            </p>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
