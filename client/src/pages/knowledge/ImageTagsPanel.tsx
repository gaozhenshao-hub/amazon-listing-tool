import { useState } from "react";
import { KnowledgeTag } from "./KnowledgeTag";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { IMAGE_TAGGING_OPTIONS } from "@shared/imageTagging";
import { IMAGE_BELONG_HIERARCHY } from "@shared/imageTagConstants";
import { imageBelongForPosition, validImageBelongSubtype } from "@shared/imageBelong";

type TaggedImage = { id: number; imageSetId?: number | null; imagePosition: string; labelRevision?:number; [key: string]: unknown };
const setFields = [["tagCategory","类目"],["tagDesignStyleV2","风格"],["tagColorSchemeV2","主色"],["tagAccentColor","提亮色"]] as const;
const localFields = [["tagImageBelong","图片归属"],["tagImageBelongSub","归属细分"],["tagImageTypeMain","图片类型"],["tagImageTypeSub","类型细分"],["tagSellingPointCategory","卖点"],["tagSellingPointDetail","卖点细分"],["tagComposition","构图"]] as const;
const fields = [...setFields,...localFields];
function initial(image: TaggedImage) {
  const values = Object.fromEntries(fields.map(([key]) => [key, typeof image[key] === "string" ? image[key] as string : ""]));
  if (image.imageSetId !== null) values.tagImageBelong ||= imageBelongForPosition(image.imagePosition);
  values.tagImageBelongSub = validImageBelongSubtype(values.tagImageBelong, values.tagImageBelongSub) || "";
  return values;
}

function TagsPanel({ image, onSave }: { image: TaggedImage; onSave?: (draft: Record<string, string>) => Promise<void> }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(() => initial(image));
  const [saving, setSaving] = useState(false);
  async function save() { if (!onSave) return; setSaving(true); try { const original=initial(image); await onSave(Object.fromEntries(Object.entries(draft).filter(([key,value])=>value!==original[key]))); setEditing(false); } catch { toast.error("标签未保存，请重试或确认编辑权限"); } finally { setSaving(false); } }
  // Story cards have source structure labels only; do not request creative AI tags.
  const visibleFields = image.imagePosition === "brand_story" ? [...setFields,...localFields.slice(0,2)] : fields;
  const values = editing ? draft : initial(image);
  const options: Record<string, readonly string[]> = {
    tagImageBelong: Object.keys(IMAGE_BELONG_HIERARCHY),
    tagImageBelongSub: (IMAGE_BELONG_HIERARCHY as Record<string, readonly string[]>)[values.tagImageBelong] || [],
    tagCategory: IMAGE_TAGGING_OPTIONS.categories,
    tagImageTypeMain: Object.keys(IMAGE_TAGGING_OPTIONS.imageTypes),
    tagImageTypeSub: (IMAGE_TAGGING_OPTIONS.imageTypes as Record<string, readonly string[]>)[values.tagImageTypeMain] || [],
    tagSellingPointCategory: Object.keys(IMAGE_TAGGING_OPTIONS.sellingPoints),
    tagSellingPointDetail: IMAGE_TAGGING_OPTIONS.sellingPoints[values.tagSellingPointCategory] || [],
    tagComposition: IMAGE_TAGGING_OPTIONS.compositions,
    tagDesignStyleV2: IMAGE_TAGGING_OPTIONS.styles,
    tagColorSchemeV2: IMAGE_TAGGING_OPTIONS.colors,
    tagAccentColor: IMAGE_TAGGING_OPTIONS.colors,
  };
  function change(key: string, value: string) {
    const dependent: Record<string, string> = { tagImageBelong: "tagImageBelongSub", tagImageTypeMain: "tagImageTypeSub", tagSellingPointCategory: "tagSellingPointDetail" };
    setDraft(old => ({ ...old, [key]: value, ...(dependent[key] ? { [dependent[key]]: "" } : {}) }));
  }
  return <aside className="min-w-0 rounded-lg border bg-background p-4 text-sm leading-normal" aria-label="图片标签">
    <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">图片标签</h3>
      {onSave && !editing && <Button size="sm" variant="ghost" onClick={() => { setDraft(initial(image)); setEditing(true); }}><Pencil className="mr-1 h-3.5 w-3.5" />编辑</Button>}
    </div>
    <dl className="space-y-2.5">{visibleFields.map(([key, label]) => <div key={key} className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-2">
      <dt className="pt-1 text-xs text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">
        {editing && (image.imageSetId === null || !setFields.some(([field])=>field===key)) ? <select aria-label={label} className="w-full rounded border bg-background p-1 text-sm" value={draft[key]} onChange={e => change(key, e.target.value)}>
          <option value="">{key === "tagAccentColor" ? "无明显提亮色" : "未设置"}</option>{[...new Set([...(options[key] || []), ...(draft[key] ? [draft[key]] : [])])].map(value => <option key={value} value={value}>{value}</option>)}
        </select> : <KnowledgeTag tone={setFields.some(([field])=>field===key) ? "set" : "local"} color={key === "tagColorSchemeV2" || key === "tagAccentColor"}>{values[key] || (key === "tagAccentColor" && image[key] === "" ? "无明显提亮色" : "未设置")}</KnowledgeTag>}
      </dd></div>)}</dl>
    {editing && <div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(false)}>取消</Button><Button size="sm" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存标签"}</Button></div>}
  </aside>;
}

function EditablePanel({image}: {image: TaggedImage}) {
  const utils = trpc.useUtils(), mutation = trpc.kbImages.confirmImageTags.useMutation(), standalone=trpc.kbImages.saveStandaloneTags.useMutation();
  return <TagsPanel image={image} onSave={async draft => {
    if (image.imageSetId === null) await standalone.mutateAsync({id:image.id,revision:image.labelRevision || 0,tags:draft});
    else await mutation.mutateAsync({ imageId: image.id, ...draft });
    toast.success("标签已保存");
    await utils.kbImages.invalidate();
  }} />;
}
export default function ImageTagsPanel({image,canEdit=false}: {image: TaggedImage;canEdit?: boolean}) {
  return canEdit ? <EditablePanel image={image} /> : <TagsPanel image={image} />;
}
