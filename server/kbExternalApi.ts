/**
 * kbExternalApi.ts — 知识库对外 REST API
 * 供 Emperor 皇帝平台跨系统调用。
 * 只有配置了可验证的调用方—工作空间绑定时才可开放读取。
 */
import { Router, Request, Response } from "express";
const router = Router();

// ─── 鉴权中间件 ──────────────────────────────────────────────────────────────
function workspaceBindingUnavailable(res: Response) {
  res.status(503).json({
    error: "WORKSPACE_SCOPE_UNAVAILABLE",
    message: "Knowledge-base access is unavailable until a verified caller-to-workspace binding is configured",
  });
}

router.use((_req: Request, res: Response) => workspaceBindingUnavailable(res));

// ─── GET /api/external/kb/stats ───────────────────────────────────────────────
// 获取知识库统计（各类型数量）
router.get("/stats", (_req: Request, res: Response) => workspaceBindingUnavailable(res));

// ─── POST /api/external/kb/search ─────────────────────────────────────────────
// 知识库混合检索（L1 快速扫描 → L2 摘要确认 → L3 按需详情）
// Body: { query, types?, category?, limit?, level? }
router.post("/search", (_req: Request, res: Response) => workspaceBindingUnavailable(res));

// ─── POST /api/external/kb/rag ────────────────────────────────────────────────
// RAG 专用接口：返回格式化的 few-shot 文本，可直接注入 systemPrompt
// Body: { query, type, limit?, includeAnalysis? }
router.post("/rag", (_req: Request, res: Response) => workspaceBindingUnavailable(res));

// ─── GET /api/external/kb/collections ─────────────────────────────────────────
// 获取所有知识库集合定义
router.get("/collections", (_req: Request, res: Response) => {
  const collections = [
    { slug: "kb-product", name: "产品创新知识库", type: "product", description: "优秀产品创意案例，含AI分析和优秀原因" },
    { slug: "kb-listing", name: "Listing文案知识库", type: "listing", description: "优秀Listing文案案例，含标题/五点/描述" },
    { slug: "kb-image", name: "图片知识库", type: "image", description: "优秀图片集案例，含构图/色彩/风格分析" },
    { slug: "kb-skill", name: "运营技巧知识库", type: "skill", description: "运营经验和最佳实践" },
    { slug: "kb-video", name: "视频知识库", type: "video", description: "优秀视频案例，含脚本分析" },
  ];
  res.json({ success: true, collections });
});

export { router as kbExternalApiRouter };
