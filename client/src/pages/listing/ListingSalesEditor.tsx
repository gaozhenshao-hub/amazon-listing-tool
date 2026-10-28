import {useState} from 'react';
import {Pencil} from 'lucide-react';
import {trpc} from '@/lib/trpc';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {sumVariantPurchases} from '../../../../shared/competitorPresentation';
export default function ListingSalesEditor({projectId,asin,data}:{projectId:number;asin:string;data:any}){
 const [open,setOpen]=useState(false),[value,setValue]=useState('');const utils=trpc.useUtils();const save=trpc.listingInputs.calibrateSales.useMutation();
 const sales=sumVariantPurchases(data?.research,asin,data?.manualSales?.value);
 const commit=async(v:number|null)=>{try{await save.mutateAsync({projectId,asin,value:v});await utils.analysis.listByProject.invalidate({projectId});setOpen(false);toast.success(v===null?'已恢复抓取销量':'销量已校准');}catch(e){toast.error(e instanceof Error?e.message:'保存失败');}};
 return <div className="px-5 pb-4"><button type="button" aria-label={`${asin} 编辑销量`} onClick={()=>{setValue(sales.value===null?'':String(sales.value));setOpen(true);}} className="flex items-center gap-2 rounded-md px-2 py-1 text-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span className="text-sm">月销量</span><strong className="text-2xl">{sales.value===null?'未采到':`${sales.value.toLocaleString()}${sales.lowerBound?'+':''}`}</strong><Pencil className="h-4 w-4"/><span className="text-xs">{data?.manualSales?'已校准':'点击校准'}</span></button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>校准月销量 · {asin}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">填写该商品所有子体过去一个月的合计销量。保存后用于展示、对比和后续分析，重新抓取不会覆盖。</p><Input aria-label="校准后的月销量" inputMode="numeric" value={value} onChange={e=>setValue(e.target.value)} placeholder="请输入非负整数"/><div className="flex flex-wrap justify-end gap-2">{data?.manualSales&&<Button variant="outline" disabled={save.isPending} onClick={()=>void commit(null)}>恢复抓取值</Button>}<Button variant="outline" onClick={()=>setOpen(false)}>取消</Button><Button disabled={save.isPending||!/^\d+$/.test(value)||Number(value)>1_000_000_000} onClick={()=>void commit(Number(value))}>保存销量</Button></div></DialogContent></Dialog></div>;
}
