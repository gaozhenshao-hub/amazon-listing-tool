import { useRef, useState, useEffect, useCallback } from "react";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import { Button } from "@/components/ui/button";
import ImageBriefingPanel from "./listing/ImageBriefingPanel";
import ImageReferenceStep from "./listing/ImageReferenceStep";
import SuiteDocumentWorkspace from "./listing/SuiteDocumentWorkspace";
export default function ImagePlanningPage() {
  const { selectedProjectId } = useProject();
  const beforeChange = useRef<(() => Promise<boolean>) | null>(null);
  const registerBeforeChange = useCallback(
    (fn: (() => Promise<boolean>) | null) => {
      beforeChange.current = fn;
    },
    []
  );
  return (
    <main className="mx-auto w-full max-w-[1900px] space-y-5 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">智能图片生成</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            确定策划方向，选择参考套图，再从模块大纲细化每张图片。
          </p>
        </div>
        <ProjectSelector
          beforeChange={async () =>
            !beforeChange.current || (await beforeChange.current())
          }
        />
      </header>
      {selectedProjectId ? (
        <ImageWorkflow
          key={selectedProjectId}
          projectId={selectedProjectId}
          registerBeforeChange={registerBeforeChange}
        />
      ) : (
        <p className="rounded-xl border p-8">请先选择项目</p>
      )}
    </main>
  );
}
function ImageWorkflow({
  projectId,
  registerBeforeChange,
}: {
  projectId: number;
  registerBeforeChange: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const [step, setStep] = useState(0),
    [productionImage, setProductionImage] = useState<string | null>(null),
    save = useRef<(() => Promise<boolean>) | null>(null),
    register = useRef((fn: (() => Promise<boolean>) | null) => {
      save.current = fn;
    }).current;
  useEffect(() => {
    registerBeforeChange(async () => !save.current || (await save.current()));
    return () => registerBeforeChange(null);
  }, [registerBeforeChange]);
  async function navigate(next: number) {
    if (next === step) return;
    if (save.current && !(await save.current())) return;
    setStep(next);
  }
  const steps = [
    { label: "图片策划", detail: "持续对话 · 确定方向" },
    { label: "找参考图", detail: "人工选择 · 最多五套" },
    { label: "套图文档", detail: "所选大纲 · 图片内容" },
    { label: "AI提示词与图片制作", detail: "五段提示词 · 四步制图" },
  ];
  return (
    <>
      <nav
        aria-label="图片生成步骤"
        className="flex flex-wrap gap-3 rounded-2xl border bg-muted/20 p-3"
      >
        {steps.map((s, index) => (
          <button
            key={s.label}
            aria-current={step === index ? "step" : undefined}
            onClick={() => void navigate(index)}
            className={`flex flex-1 items-center gap-3 rounded-xl px-5 py-4 text-left ${step === index ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border">
              {index + 1}
            </span>
            <span>
              <strong className="block font-medium">{s.label}</strong>
              <small className="opacity-75">{s.detail}</small>
            </span>
          </button>
        ))}
      </nav>
      {step === 0 ? (
        <ImageBriefingPanel
          projectId={projectId}
          onContinue={() => void navigate(1)}
        />
      ) : step === 1 ? (
        <ImageReferenceStep projectId={projectId} registerSave={register} />
      ) : (
        <SuiteDocumentWorkspace
          key={step}
          projectId={projectId}
          registerSave={register}
          production={step === 3}
          requestedImageId={productionImage}
          onProduction={imageId => {
            setProductionImage(imageId);
            void navigate(3);
          }}
        />
      )}
      <div className="flex justify-between">
        {step > 0 ? (
          <Button variant="outline" onClick={() => void navigate(step - 1)}>
            上一步：{steps[step - 1].label}
          </Button>
        ) : (
          <span />
        )}
        {step < steps.length - 1 && (
          <Button variant="outline" onClick={() => void navigate(step + 1)}>
            下一步：{steps[step + 1].label}
          </Button>
        )}
      </div>
    </>
  );
}
