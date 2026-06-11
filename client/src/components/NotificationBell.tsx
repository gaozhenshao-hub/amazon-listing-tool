import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Bell, Check, CheckCheck, FileText, Package, Image, Video,
  Wrench, AlertCircle, UserCheck, XCircle, Clock, AlarmClock,
  ClipboardList,
} from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  review_submitted: { icon: FileText, color: "text-blue-600", bg: "bg-blue-100" },
  review_approved: { icon: CheckCheck, color: "text-green-600", bg: "bg-green-100" },
  review_rejected: { icon: XCircle, color: "text-red-600", bg: "bg-red-100" },
  project_assigned: { icon: UserCheck, color: "text-purple-600", bg: "bg-purple-100" },
  system_alert: { icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-100" },
  todo_due_soon: { icon: Clock, color: "text-orange-600", bg: "bg-orange-100" },
  todo_overdue: { icon: AlarmClock, color: "text-red-600", bg: "bg-red-100" },
};

const KB_TYPE_ICONS: Record<string, typeof Bell> = {
  kb_product: Package, kb_listing: FileText, kb_image: Image,
  kb_video: Video, kb_skill: Wrench,
  team_task: ClipboardList, product_todo: ClipboardList,
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: unreadCount = 0 } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30000, // Poll every 30 seconds
  });

  const { data: notifications = [], isLoading } = trpc.notification.list.useQuery(
    { limit: 30 },
    { enabled: open }
  );

  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
    },
  });

  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
      toast.success("已全部标为已读");
    },
  });

  const handleMarkRead = (id: number) => {
    markReadMutation.mutate({ id });
  };

  const formatTime = (ts: string | Date) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}天前`;
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end" sideOffset={8}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">通知中心</h4>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost" size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                全部已读
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              加载中...
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">暂无通知</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map(n => {
                const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.system_alert;
                const Icon = config.icon;
                const KbIcon = n.relatedType ? KB_TYPE_ICONS[n.relatedType] : null;
                const isUnread = n.isRead === 0;

                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 px-4 py-3 transition-colors cursor-pointer hover:bg-accent/50 ${
                      isUnread ? "bg-primary/5" : ""
                    }`}
                    onClick={() => { if (isUnread) handleMarkRead(n.id); }}
                  >
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${config.bg}`}>
                      <Icon className={`h-4 w-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-tight ${isUnread ? "font-medium" : ""}`}>
                          {n.title}
                        </p>
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                        )}
                      </div>
                      {n.content && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {n.content}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {formatTime(n.createdAt)}
                        </span>
                        {KbIcon && (
                          <KbIcon className="h-3 w-3 text-muted-foreground/60" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
