import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
export default function DeleteAcquisitionButton({jobId,status,onDeleted}:{jobId:number;status:string;onDeleted?:()=>void}) {
  const utils=trpc.useUtils();
  const deletion=trpc.acquisition.deleteJob.useMutation({
    onSuccess:async()=>{await utils.acquisition.listJobs.invalidate();toast.success('已删除采集记录，已入库素材保留');onDeleted?.();},
    onError:error=>toast.error(error.message),
  });
  return <Button size="sm" variant="ghost" className="text-destructive" disabled={deletion.isPending||['queued','running'].includes(status)} title={['queued','running'].includes(status)?'采集完成后可删除':'只删除采集记录，保留已入库图片、视频和标签'} onClick={()=>deletion.mutate({jobId})}><Trash2 className="mr-1 h-4 w-4"/>{deletion.isPending?'删除中…':'删除记录'}</Button>;
}
