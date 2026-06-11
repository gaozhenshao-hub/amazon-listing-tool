import { Users, User } from "lucide-react";
import { cn } from "@/lib/utils";

type KBScope = "mine" | "shared" | "all";

interface KBScopeToggleProps {
  value: KBScope;
  onChange: (scope: KBScope) => void;
  className?: string;
}

export function KBScopeToggle({ value, onChange, className }: KBScopeToggleProps) {
  return (
    <div className={cn("flex items-center rounded-lg border bg-muted/30 p-0.5", className)}>
      <button
        onClick={() => onChange("mine")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
          value === "mine"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <User className="h-3.5 w-3.5" />
        我的
      </button>
      <button
        onClick={() => onChange("shared")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
          value === "shared"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Users className="h-3.5 w-3.5" />
        全部共享
      </button>
    </div>
  );
}

export type { KBScope };
