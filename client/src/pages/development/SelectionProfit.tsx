import { Input } from "@/components/ui/input";
import {
  PICK_CATEGORIES,
  PICK_COMMISSION_SOURCE,
  PICK_FEE_SOURCE,
  PICK_REFUND_SOURCE,
  PICK_STORAGE_SOURCE,
  calculatePickProfit,
} from "@shared/productSelectionProfit";
import type { PickProfit } from "@shared/productSelection";

export const fmt = (value: number | null | undefined, places = 0) =>
  value == null
    ? "—"
    : value.toLocaleString("zh-CN", {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
      });
export const percent = (value: number | null | undefined) =>
  value == null ? "—" : fmt(value * 100, 2) + "%";
const money = (value: number | null | undefined, prefix: string) =>
  value == null ? "—" : prefix + fmt(value, 2);
type Fx = { rate: number; date: string; stale: boolean } | null | undefined;

export function SelectionProfit({
  value,
  onChange,
  disabled,
  fx,
  site,
}: {
  value: PickProfit;
  onChange: (value: PickProfit) => void;
  disabled: boolean;
  fx: Fx;
  site: string;
}) {
  const set = <K extends keyof PickProfit>(key: K, next: PickProfit[K]) =>
    onChange({ ...value, [key]: next });
  const estimate =
    site === "amazon.com" ? calculatePickProfit(value, fx?.rate ?? null) : null;
  const numeric = (
    label: string,
    key: keyof PickProfit,
    fallback: number | null = null,
    max?: number
  ) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input
        disabled={disabled}
        type="number"
        min={0}
        max={max}
        step="any"
        value={String(value[key] ?? "")}
        onChange={event =>
          set(
            key,
            event.target.value === "" ? fallback : event.target.valueAsNumber
          )
        }
      />
    </label>
  );
  const periods = estimate && [
    { label: "1–9 月 · 普通配送", value: estimate.ordinary },
    { label: "10–12 月 · 旺季配送", value: estimate.peak },
    { label: "1 月 1–14 日 · 旺季配送", value: estimate.januaryPeak },
    { label: "10 月 1–14 日 · 普通配送", value: estimate.octoberOrdinary },
  ];

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">利润测算 · 亚马逊美国站 FBA</h2>
      {site !== "amazon.com" && (
        <p className="text-sm text-muted-foreground">
          当前产品来自其他站点。费率表仅覆盖美国站。
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <label className="grid gap-1 text-sm">
          产品名称
          <Input
            disabled={disabled}
            maxLength={200}
            value={value.product}
            onChange={e => set("product", e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">
          产品参数
          <Input
            disabled={disabled}
            maxLength={2000}
            value={value.parameters}
            onChange={e => set("parameters", e.target.value)}
          />
        </label>
        {numeric("包装长度（cm）", "packageLength")}
        {numeric("包装宽度（cm）", "packageWidth")}
        {numeric("包装高度（cm）", "packageHeight")}
        {numeric("包装重量（kg）", "packageKg")}
        {numeric("商品售价（USD）", "price")}
        {numeric("采购成本（CNY）", "purchaseCny")}
        {numeric("头程单价（CNY/kg）", "inboundRate", 0)}
        <label className="grid gap-1 text-sm">
          头程计费重量
          <select
            className="rounded-md border bg-background px-2"
            disabled={disabled}
            value={value.inboundMode}
            onChange={e =>
              set("inboundMode", e.target.value as PickProfit["inboundMode"])
            }
          >
            <option value="actual">实重</option>
            <option value="chargeable">实重与体积重取大（÷ 5000）</option>
          </select>
        </label>
        {numeric("其他商品成本（CNY）", "otherCny", 0)}
        {numeric("退货率（%）", "returnRate", 0, 100)}
        {numeric("每件退货额外费用（USD）", "extraPerReturnUsd", 0)}
        {numeric("平均仓储时间（月）", "storageMonths", 0, 60)}
        <label className="grid gap-1 text-sm">
          商品类别
          <select
            className="rounded-md border bg-background px-2"
            disabled={disabled}
            value={value.category}
            onChange={e => set("category", e.target.value)}
          >
            {Object.entries(PICK_CATEGORIES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {numeric("手动销售佣金（%，选填）", "commissionOverride", null, 100)}
        {numeric("手动 FBA 配送费（USD，选填）", "fulfillmentOverrideUsd")}
        {numeric("手动 USD/CNY 汇率（选填）", "exchangeOverride")}
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            disabled={disabled || value.category === "apparel"}
            checked={value.apparel || value.category === "apparel"}
            onChange={e => set("apparel", e.target.checked)}
          />{" "}
          按服装配送费率
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        USD/CNY {fmt(value.exchangeOverride ?? fx?.rate, 4)}。
        {value.exchangeOverride
          ? "使用本表手动汇率"
          : fx
            ? "欧洲央行参考日 " +
              fx.date +
              (fx.stale ? "（更新暂未成功，沿用上次汇率）" : "，每周刷新")
            : "等待欧洲央行参考汇率"}
        。
      </p>
      {estimate && (
        <p className="text-sm">
          尺寸分段 {estimate.tier} · 配送计费重量 {fmt(estimate.shippingLb, 2)}{" "}
          lb · 头程费用 {money(estimate.inbound, "¥")} · 每单销售佣金{" "}
          {money(estimate.commission, "$")} · 每次全额退款保留佣金{" "}
          {money(estimate.refundFee, "$")}
        </p>
      )}
      {periods ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead className="bg-muted">
              <tr>
                {[
                  "计费时段",
                  "FBA 配送",
                  "仓储",
                  "单件净利润",
                  "净利率",
                  "ROI",
                ].map(label => (
                  <th key={label} className="p-2 text-left">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map(({ label, value: season }) => (
                <tr className="border-b" key={label}>
                  <td className="p-2">{label}</td>
                  <td className="p-2">
                    {money(season.fulfillment, "$")}
                    {value.fulfillmentOverrideUsd === null && (
                      <small className="block text-muted-foreground">
                        基础 {money(season.base, "$")} · 附加{" "}
                        {money(season.fuel, "$")}
                      </small>
                    )}
                  </td>
                  <td className="p-2">{money(season.storage, "$")}</td>
                  <td className="p-2">
                    {money(season.cny, "¥")} / {money(season.usd, "$")}
                  </td>
                  <td className="p-2">{percent(season.margin)}</td>
                  <td className="p-2">{percent(season.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          填写售价和包装尺寸、重量后显示费用。补齐采购成本和汇率后显示利润。
        </p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        按发出一件的期望利润测算。退货全额退款、商品价值归零，采购、头程和配送费用照计，另计退款管理费及填写的退货额外费用。净利率按退款后的期望收入计算。ROI
        按采购、头程和其他商品成本计算。使用 2026 年美国站费率，FBA 旺季从 10 月
        15 日至次年 1 月 14 日，仓储旺季为 10–12 月。
        <span className="ml-1">
          {[
            [PICK_FEE_SOURCE, "配送"],
            [PICK_STORAGE_SOURCE, "仓储"],
            [PICK_COMMISSION_SOURCE, "佣金"],
            [PICK_REFUND_SOURCE, "退款"],
          ].map(([url, label]) => (
            <a
              key={url}
              className="mr-2 underline"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {label}
            </a>
          ))}
        </span>
      </p>
    </section>
  );
}
