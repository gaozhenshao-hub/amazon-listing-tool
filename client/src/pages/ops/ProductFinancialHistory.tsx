import { useMemo, useState } from "react";
import { aggregateMonthlyFinancialRows } from "@shared/monthlyFinancialRead";
import type { ProductBoardReadResult } from "@shared/productBoardRead";
import { ProfitMonthlyDetails } from "./ProfitMonthlyDetails";

type Product = ProductBoardReadResult["products"][number];
/** Reuses the complete server-authorized history and existing financial
 * aggregation. No old hand-maintained profit or cost-sheet value is an input. */
export function ProductFinancialHistory({ product, rows, sources }: {
  product: Product; rows: ProductBoardReadResult["pageRows"]; sources: ProductBoardReadResult["sources"];
}) {
  const [offset, setOffset] = useState(0), size = 20;
  const { originals, groups, complete } = useMemo(() => {
    const keys = new Set(product.sourceRows.map(row => `${row.batchId}:${row.rowIndex}`));
    const originals = rows.filter(row => keys.has(`${row.batchId}:${row.rowIndex}`));
    return { originals, groups: aggregateMonthlyFinancialRows(originals), complete: originals.length === keys.size && keys.size === product.sourceRows.length };
  }, [product.sourceRows, rows]);
  if (!complete) return <p role="alert">完整历史月报原行引用不一致，未显示部分财务明细；请重新读取。</p>;
  const points = sources.map(source => ({ month: source.month, missingReason: source.missingReason }));
  return <section aria-label="产品完整历史月报" className="min-w-0 max-w-full space-y-4">
    <h4 className="font-semibold">完整历史月报 · {product.parentAsin ?? "未分配原行"} · {product.currency ?? "币种未知"}</h4>
    <ProfitMonthlyDetails historyComplete label="父体全部历史月报" groups={groups.filter(group => group.dimension === (product.basis === "unallocated_rows" ? "unallocated" : "parent"))} points={points} rows={originals} />
    <h5 className="font-medium">子 ASIN 全部历史（{product.children.length} 个）</h5>
    {product.children.length > size && <nav aria-label="历史月报子体分页" className="flex flex-wrap items-center gap-3 text-sm"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - size))}>历史子体上一页</button><span>{offset + 1}–{Math.min(offset + size, product.children.length)} / {product.children.length}</span><button type="button" disabled={offset + size >= product.children.length} onClick={() => setOffset(offset + size)}>历史子体下一页</button></nav>}
    {product.children.slice(offset, offset + size).map(child => <details key={child.id} className="min-w-0 rounded border p-3"><summary className="cursor-pointer break-words">{child.asin} · {child.title || "名称未提供"} · 完整历史月报</summary><p className="my-2 break-words text-sm">SKU：{child.skus.join("、") || "未提供"}</p><ProfitMonthlyDetails historyComplete label={`${child.asin} 全部历史月报`} groups={groups.filter(group => group.dimension === "asin" && group.asin === child.asin)} points={points} rows={originals} /></details>)}
    {!product.children.length && <p>没有可核验子体原行，父体合计不捏造子体。</p>}
  </section>;
}
