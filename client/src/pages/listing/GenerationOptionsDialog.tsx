import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DEFAULT_IMAGE_COPY_LIMITS,
  IMAGE_COPY_LIMIT_FIELDS,
  imageCopyLimitsSchema,
  type ImageCopyLimitField,
  type ImageCopyLimits,
} from "@shared/imageCopyLimits";

const copyLimitFields = Object.entries(IMAGE_COPY_LIMIT_FIELDS) as Array<
  [ImageCopyLimitField, string]
>;

export default function GenerationOptionsDialog({
  title,
  busy,
  onClose,
  onSubmit,
  copyTargets,
  initialCopyLimits,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (message: string, preserveManual: boolean, copyLimits?: ImageCopyLimits) => Promise<void>;
  copyTargets?: ReadonlyArray<{ id: string; title: string }>;
  initialCopyLimits?: ImageCopyLimits | null;
}) {
  const [message, setMessage] = useState("");
  const [preserveManual, setPreserveManual] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copyLimits, setCopyLimits] = useState<Partial<Record<ImageCopyLimitField, string>>>(() =>
    Object.fromEntries(copyLimitFields.flatMap(([key]) => {
      const value = (initialCopyLimits ?? DEFAULT_IMAGE_COPY_LIMITS)[key];
      return value === undefined ? [] : [[key, String(value)]];
    }))
  );
  const [excludedImageIds, setExcludedImageIds] = useState<string[]>(() =>
    initialCopyLimits?.excludedImageIds.filter(id => copyTargets?.some(item => item.id === id)) ?? []
  );
  const enteredLimits = copyLimitFields.flatMap(([key]) =>
    copyLimits[key] ? [[key, Number(copyLimits[key])]] : []
  );
  const rules = enteredLimits.length
    ? imageCopyLimitsSchema.safeParse({ ...Object.fromEntries(enteredLimits), excludedImageIds })
    : undefined;
  const waiting = busy || submitting;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !waiting) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className={copyTargets ? "max-h-[90vh] overflow-y-auto" : undefined}>
        <DialogTitle>{title}</DialogTitle>
        <textarea
          aria-label="本次生成要求"
          placeholder="填写本次生成要求，可留空"
          className="min-h-32 w-full rounded-xl border p-3 text-sm"
          maxLength={4000}
          value={message}
          onChange={event => setMessage(event.target.value)}
          disabled={waiting}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={preserveManual}
            disabled={waiting}
            onChange={event => setPreserveManual(event.target.checked)}
          />
          保留人工修改的内容
        </label>
        {copyTargets && (
          <fieldset className="space-y-3 rounded-lg border p-3 text-sm" disabled={waiting}>
            <legend className="px-1 font-medium">本次上图文案规则</legend>
            <p className="text-muted-foreground">
              已填入建议上限，可修改或清空。按词计数，汉字逐字计数。清空的项目不检查上限，需要长文案的图位可在下方单独勾选。
            </p>
            <div className="grid grid-cols-2 gap-2">
              {copyLimitFields.map(([key, label]) => (
                <label key={key} className="space-y-1">
                  <span>{label}上限</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={1}
                    placeholder="不限"
                    value={copyLimits[key] ?? ""}
                    className="w-full rounded-md border bg-background p-2"
                    onChange={event => setCopyLimits(previous => ({ ...previous, [key]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            {rules?.success === false && (
              <p role="alert" className="text-destructive">请输入 1–500 之间的整数。</p>
            )}
            {!!enteredLimits.length && (
              <details>
                <summary className="cursor-pointer">允许长文案的图位{excludedImageIds.length ? `（${excludedImageIds.length}）` : ""}</summary>
                <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">
                  {copyTargets.map(({ id, title }) => (
                    <label key={id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={excludedImageIds.includes(id)}
                        onChange={event => setExcludedImageIds(previous => event.target.checked
                          ? [...previous, id]
                          : previous.filter(item => item !== id))}
                      />
                      {title}
                    </label>
                  ))}
                </div>
              </details>
            )}
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={waiting} onClick={onClose}>
            返回
          </Button>
          <Button
            disabled={waiting || rules?.success === false}
            onClick={async () => {
              setSubmitting(true);
              try {
                if (rules?.success)
                  await onSubmit(message.trim(), preserveManual, rules.data);
                else
                  await onSubmit(message.trim(), preserveManual);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {waiting ? "正在提交…" : "开始生成"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
