/**
 * kbExternalApi.ts — 知识库对外 REST API
 * 供 Emperor 皇帝平台跨系统调用，无需 Manus OAuth
 * 鉴权：EMPEROR_KB_API_KEY（在 .env 中配置）
 */
import { Router, Request, Response } from "express";
import {
  getL1Index,
  getL2Summary,
  getL3Detail,
  formatForPrompt,
  type KbItemType,
} from "./kbContextEngine";
import { getKbStats } from "./kbDb";

const router = Router();

// ─── 鉴权中间件 ──────────────────────────────────────────────────────────────
function authMiddleware(req: Request, res: Response, next: () => void) {
  const apiKey = process.env.EMPEROR_KB_API_KEY || "emperor-kb-2024";
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || token !== apiKey) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid API key" });
    return;
  }
  next();
}

router.use(authMiddleware);

// ─── GET /api/external/kb/stats ───────────────────────────────────────────────
// 获取知识库统计（各类型数量）
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    // 使用 userId=0 + scope=shared 获取全局共享知识库统计
    const stats = await getKbStats(0, "shared" as any);
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
});

// ─── POST /api/external/kb/search ─────────────────────────────────────────────
// 知识库混合检索（L1 快速扫描 → L2 摘要确认 → L3 按需详情）
// Body: { query, types?, category?, limit?, level? }
router.post("/search", async (req: Request, res: Response) => {
  try {
    const {
      query = "",
      types,
      category,
      limit = 5,
      level = "L2",
    } = req.body as {
      query?: string;
      types?: KbItemType[];
      category?: string;
      limit?: number;
      level?: "L1" | "L2" | "L3";
    };

    // L1：快速索引扫描
    const l1Items = await getL1Index({
      types,
      category,
      keyword: query,
      scope: "shared",
      userId: 0,
    });

    const topItems = l1Items.slice(0, Math.min(limit * 3, 30));

    if (level === "L1" || topItems.length === 0) {
      return res.json({ success: true, level: "L1", items: topItems.slice(0, limit), totalScanned: l1Items.length });
    }

    // L2：加载摘要层
    const idsArr = topItems.map((i) => i.id);
    const typesArr = topItems.map((i) => i.type);
    const l2Items = await getL2Summary(idsArr, typesArr);

    if (level === "L2") {
      return res.json({ success: true, level: "L2", items: l2Items.slice(0, limit), totalScanned: l1Items.length });
    }

    // L3：加载完整内容（仅前 limit 条）
    const topL2 = l2Items.slice(0, limit);
    const l3Items = await getL3Detail(topL2.map((i) => i.id), topL2.map((i) => i.type as KbItemType));
    return res.json({ success: true, level: "L3", items: l3Items, totalScanned: l1Items.length });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
});

// ─── POST /api/external/kb/rag ────────────────────────────────────────────────
// RAG 专用接口：返回格式化的 few-shot 文本，可直接注入 systemPrompt
// Body: { query, type, limit?, includeAnalysis? }
router.post("/rag", async (req: Request, res: Response) => {
  try {
    const {
      query = "",
      type,
      limit = 3,
    } = req.body as {
      query?: string;
      type?: KbItemType;
      limit?: number;
      includeAnalysis?: boolean;
    };

    const l1Items = await getL1Index({
      types: type ? [type] : undefined,
      keyword: query,
      scope: "shared",
      userId: 0,
    });

    const topItems = l1Items.slice(0, limit * 2);
    if (topItems.length === 0) {
      return res.json({ success: true, fewShotText: "", items: [] });
    }

    const topSlice = topItems.slice(0, limit);
    const l3Items = await getL3Detail(topSlice.map((i) => i.id), topSlice.map((i) => i.type as KbItemType));

    // 使用 kbContextEngine 的 formatForPrompt 格式化 few-shot 文本
    const innerText = formatForPrompt(l3Items, "L3");
    const fewShotText = [
      "[KNOWLEDGE CONTEXT - 以下是从知识库中检索到的优秀案例，请参考其风格和结构：]",
      "",
      innerText,
      "[END OF KNOWLEDGE CONTEXT]",
    ].join("\n");

    return res.json({
      success: true,
      fewShotText,
      items: l3Items,
      totalScanned: l1Items.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
});

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
