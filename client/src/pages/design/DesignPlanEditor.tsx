import { useRef, useState } from "react";
import { ChevronDown, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import {
  changeDesignOption,
  designParameterKeys,
  designParameterOptions,
  designReferenceLimit,
  defaultDesignParams,
  type DesignDraft,
  type DesignParams,
} from "@shared/designStudio";

export type DesignReference = { id: string; name: string; bytes?: number };
export function DesignParameters({
  params,
  onChange,
  disabled,
  prefix = "",
}: {
  params: DesignParams;
  onChange: (value: DesignParams) => void;
  disabled: boolean;
  prefix?: string;
}) {
  return (
    <>
      {designParameterKeys(params).map(key => (
        <label key={key} className="design-select">
          <select
            aria-label={
              prefix +
              {
                model: "生图模型",
                count: "生成数量",
                thinking: "思考等级",
                version: "模型版本",
                aspect_ratio: "图片比例",
                resolution: "分辨率",
                quality: "画质",
                background: "背景",
              }[key]
            }
            value={params[key]}
            disabled={disabled}
            onChange={e =>
              onChange(changeDesignOption(params, key, e.target.value))
            }
          >
            {designParameterOptions(params, key).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
      ))}
    </>
  );
}
export function DesignPlanEditor({
  initial,
  promptTranslation,
  disabled,
  uploading,
  upload,
  onConfirm,
  onPreview,
}: {
  initial: DesignDraft;
  promptTranslation?: string;
  disabled: boolean;
  uploading: boolean;
  upload: (
    files: FileList | null,
    current: DesignReference[],
    onUploaded: (ref: DesignReference) => void,
    maxReferences?: number
  ) => Promise<void>;
  onConfirm: (draft: DesignDraft) => void;
  onPreview: (id: string) => void;
}) {
  // Polling history must not overwrite edits to an unconfirmed plan.
  const [prompt, setPrompt] = useState(initial.prompt);
  const [params, setParams] = useState({
    ...defaultDesignParams,
    ...initial.params,
  });
  const [references, setReferences] = useState<DesignReference[]>(
    initial.references.map(id => ({ id, name: "方案参考图" }))
  );
  const maxReferences = designReferenceLimit(params);
  const picker = useRef<HTMLInputElement>(null);
  const replacing = useRef<number | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const pick = (index: number | null) => {
    replacing.current = index;
    setReplaceIndex(index);
    if (picker.current) {
      picker.current.multiple = index === null;
      picker.current.click();
    }
  };
  return (
    <div className="design-plan-editor">
      <strong>
        确认生图方案 <small>可直接修改</small>
      </strong>
      <div className="design-controls">
        <DesignParameters
          prefix="方案"
          params={params}
          onChange={setParams}
          disabled={disabled}
        />
      </div>
      <label className="design-plan-prompt-label">
        生图提示词
        <textarea
          aria-label="方案生图提示词"
          value={prompt}
          maxLength={8000}
          disabled={disabled}
          onChange={e => setPrompt(e.target.value)}
          rows={5}
        />
      </label>
      {promptTranslation && (
        <div className="design-prompt-translation">
          <strong>中文翻译</strong>
          {prompt.trim() === initial.prompt.trim() ? (
            <p>{promptTranslation}</p>
          ) : (
            <p className="design-muted">
              提示词已修改，原翻译不再对应当前内容。继续对话可重新整理双语方案。
            </p>
          )}
        </div>
      )}
      <div className="design-plan-reference-heading">
        <span>
          参考图 · {references.length}/{maxReferences}
        </span>
        <button
          className="design-plan-add"
          disabled={disabled || references.length >= maxReferences}
          onClick={() => pick(null)}
        >
          {uploading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <ImagePlus size={15} />
          )}{" "}
          添加参考图
        </button>
      </div>
      <div className="design-plan-references">
        {references.map((ref, index) => (
          <div key={ref.id}>
            <button
              onClick={() => onPreview(ref.id)}
              aria-label={`预览方案参考图 ${index + 1}`}
            >
              <img
                src={`/api/design/assets/${ref.id}`}
                alt={`方案参考图 ${index + 1}`}
              />
            </button>
            <div>
              <button
                disabled={disabled}
                onClick={() => pick(index)}
                aria-label={`更换方案参考图 ${index + 1}`}
              >
                更换
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  setReferences(v => v.filter((_, i) => i !== index))
                }
                aria-label={`移除方案参考图 ${index + 1}`}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {references.length > maxReferences && (
        <p className="design-error">
          当前模型最多支持 {maxReferences} 张参考图，请移除多余图片。
        </p>
      )}
      {!references.length && (
        <p className="design-muted">未添加参考图，将按提示词生成。</p>
      )}
      <input
        hidden
        ref={picker}
        type="file"
        multiple={replaceIndex === null}
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={async e => {
          const index = replacing.current;
          const files = e.target.files;
          await upload(
            files,
            index === null
              ? references
              : references.filter((_, i) => i !== index),
            ref =>
              setReferences(previous =>
                index === null
                  ? [...previous, ref]
                  : previous.map((r, i) => (i === index ? ref : r))
              ),
            maxReferences
          );
          if (picker.current) picker.current.value = "";
        }}
      />
      <button
        className="design-confirm-generate"
        disabled={
          disabled || !prompt.trim() || references.length > maxReferences
        }
        onClick={() =>
          onConfirm({
            prompt: prompt.trim(),
            params,
            references: references.map(r => r.id),
          })
        }
      >
        <Sparkles size={16} /> 确认并生成 {params.count} 张
      </button>
      <small className="design-plan-hint">
        使用上方修改后的提示词、参数和参考图生成 {params.count}{" "}
        张图片，按实际生成消耗额度。
      </small>
    </div>
  );
}
