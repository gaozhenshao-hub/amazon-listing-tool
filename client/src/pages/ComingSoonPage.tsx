export default function ComingSoonPage({ moduleName }: { moduleName: string }) {
  return <section className="flex min-h-[55vh] flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
    <h1 className="text-2xl font-semibold">{moduleName}</h1>
    <p className="text-muted-foreground">此模块待开发</p>
  </section>;
}
