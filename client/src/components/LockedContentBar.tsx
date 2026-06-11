import { Lock, Unlock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LockedContentBarProps {
  /** Whether the content is currently locked */
  locked: boolean;
  /** Label for the content type, e.g. "标题", "卖点" */
  label: string;
  /** Callback when unlock button is clicked */
  onUnlock: () => void;
  /** Optional: additional info text */
  info?: string;
}

/**
 * A reusable bar that shows lock/unlock status for confirmed content.
 * When locked: green border, lock icon, "已锁定" badge, unlock button.
 * When unlocked: the parent component handles showing the edit UI.
 */
export default function LockedContentBar({ locked, label, onUnlock, info }: LockedContentBarProps) {
  if (!locked) return null;

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg border-2 border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-green-600" />
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span className="text-sm font-medium text-green-800 dark:text-green-300">
          {label}已确认并锁定
        </span>
        <Badge className="bg-green-600 text-white text-[10px] px-1.5">
          已同步
        </Badge>
        {info && (
          <span className="text-xs text-green-600 dark:text-green-400">{info}</span>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
        onClick={onUnlock}
      >
        <Unlock className="h-3 w-3 mr-1" />
        解锁编辑
      </Button>
    </div>
  );
}
