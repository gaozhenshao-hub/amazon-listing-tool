import { z } from "zod";

export const materialName = z
  .string()
  .trim()
  .min(1, "请填写名称")
  .max(180)
  .refine(v => !/[\\/\x00-\x1f\x7f]/.test(v), "名称不能包含斜杠或控制字符");
export const materialTarget = z.object({
  projectId: z.string().uuid().nullable(),
});
export const materialFileLimit = 100_000_000;
export const materialExtensions = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "tif",
  "tiff",
  "psd",
  "psb",
  "ai",
  "eps",
  "svg",
  "pdf",
  "zip",
  "7z",
  "rar",
  "mp4",
  "mov",
  "blend",
  "glb",
  "gltf",
  "obj",
  "fbx",
  "stl",
  "txt",
  "docx",
  "xlsx",
  "pptx",
];
export function materialSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
