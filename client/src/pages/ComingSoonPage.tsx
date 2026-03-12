import { Construction, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ComingSoonPageProps {
  moduleName: string;
}

export default function ComingSoonPage({ moduleName }: ComingSoonPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-6 p-10 text-center">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Construction className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">{moduleName}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              该模块正在开发中，即将推出。敬请期待！
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI赋能，全链路覆盖</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
