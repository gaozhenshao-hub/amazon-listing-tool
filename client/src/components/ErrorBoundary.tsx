import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  incidentId: string | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, incidentId: null };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, incidentId: null };
  }

  componentDidCatch(error: Error) {
    // Keep diagnostic detail out of the customer-facing screen while preserving
    // browser-console evidence for an authenticated support investigation.
    console.error("[UI Error Boundary]", error);
    this.setState({ incidentId: typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `ui-${Date.now().toString(36)}` });
  }

  private retryRender = () => {
    this.setState({ hasError: false, incidentId: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-5">
          <section className="w-full max-w-lg rounded-2xl border bg-card p-7 text-card-foreground shadow-sm sm:p-9" role="alert" aria-live="assertive">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><AlertTriangle className="h-6 w-6" /></div>
            <h1 className="text-xl font-semibold">此页面暂时无法正常显示</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">已保护当前数据，不会自动提交或覆盖您的内容。可先尝试重新恢复页面；若仍发生，请返回首页后重新进入此功能。</p>
            {this.state.incidentId ? <p className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">页面错误编号：{this.state.incidentId}</p> : null}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={this.retryRender}><RotateCcw className="mr-2 h-4 w-4" />尝试恢复</Button>
              <Button type="button" variant="outline" onClick={() => { window.location.assign("/"); }}><Home className="mr-2 h-4 w-4" />返回首页</Button>
              <Button type="button" variant="ghost" className="sm:ml-auto" onClick={() => window.location.reload()}>刷新页面</Button>
            </div>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
