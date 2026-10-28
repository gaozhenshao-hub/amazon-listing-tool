import { useEffect, useState } from 'react';
import { useNearViewport } from '@/lib/useNearViewport';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { OperationsCostSheetReadOnlyContent } from './OperationsCostSheetReadOnly';
import { OperationsCostSheetEmbeddedActions, subscribeOperationsCostSheetChanges } from './OperationsCostSheetActions';

export function ProductCostSummary(props: { parentAsin: string; storeName: string; country: string; name: string }) {
  const { user } = useAuth(), [open, setOpen] = useState(false), utils = trpc.useUtils();
  const { ref, visible } = useNearViewport();
  const input = { expectedWorkspaceId: user?.defaultWorkspaceId || 0, parentAsin: props.parentAsin, storeName: props.storeName, country: props.country };
  const query = trpc.productCostsReadOnly.get.useQuery(input, { enabled: !!user?.defaultWorkspaceId && (visible || open), staleTime: 300000, retry: false, refetchOnWindowFocus: false, trpc: { context: { skipBatch: true } } });
  useEffect(() => subscribeOperationsCostSheetChanges(() => { void utils.productCostsReadOnly.get.invalidate(); }), [utils]);
  const result = query.data, rows = result?.rows.filter(row => !row.orphaned) || [];
  const cells = rows.length ? rows : [{ key: props.parentAsin, name: props.name, profit: null }];
  return <div ref={ref} className="min-w-[260px] max-w-[580px] flex-1" onClick={event => event.stopPropagation()}>
    <button type="button" aria-label={`打开产品基本信息 ${props.parentAsin}`} className="block w-full rounded-md border bg-background text-xs text-center overflow-x-auto" onClick={() => setOpen(true)}>
      <table className="w-full border-collapse whitespace-nowrap" aria-label="产品基本信息">
        <tbody>
          <tr><th className="border-r border-b px-3 py-1 font-normal">产品名称</th>{cells.map(row => <td className="border-b px-3 py-1 max-w-48 truncate" key={row.key} title={row.name || row.key}>{row.name || row.key}</td>)}</tr>
          <tr className="bg-amber-50"><th className="border-r border-b px-3 py-1 font-normal">毛利润</th>{cells.map(row => <td className={`border-b px-3 py-1 ${row.profit && row.profit.profit < 0 ? 'text-red-600' : ''}`} key={row.key}>{row.profit ? `$${row.profit.profit.toFixed(2)}` : (!visible || query.isLoading) ? '加载中…' : query.isError ? '读取失败' : '待补充'}</td>)}</tr>
          <tr><th className="border-r px-3 py-1 font-normal">毛利率</th>{cells.map(row => <td className="px-3 py-1" key={row.key}>{row.profit ? `${row.profit.margin.toFixed(1)}%` : '待补充'}</td>)}</tr>
        </tbody>
      </table>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[96vw] max-w-[96vw] max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>产品基本信息 · {props.parentAsin}</DialogTitle><DialogDescription>已保存的产品成本与单件毛利润，金额以 USD 展示。</DialogDescription></DialogHeader>
        {query.isError && <div role="alert">成本表读取失败：{query.error.message}<button className="ml-3 underline" onClick={() => void query.refetch()}>重试</button></div>}
        {result && <OperationsCostSheetReadOnlyContent result={result} />}
        {open && user?.defaultWorkspaceId && <OperationsCostSheetEmbeddedActions scope={{ workspaceId: user.defaultWorkspaceId, parentAsin: props.parentAsin, storeName: props.storeName, country: props.country }} />}
      </DialogContent>
    </Dialog>
  </div>;
}
