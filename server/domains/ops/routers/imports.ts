import * as shared from "../routerContext";
import type { CheckItemScore, ConversionCrawlData, ImportResult, ScoringProgress, SellerSpriteProductData } from "../routerContext";

const {
  MARKETPLACE_MID_MAP,
  SELLER_CACHE_TTL,
  TRPCError,
  _productOpsSellerCache,
  and,
  asc,
  buildCrawlDataFromSellerSprite,
  checkItemOverrides,
  collectConversionData,
  collectMultipleAsins,
  competitorMonitors,
  competitorSnapshots,
  conversionCheckItems,
  conversionComparisons,
  conversionScores,
  conversionSuggestions,
  desc,
  eq,
  executionReviews,
  findMatchedSid,
  generateMockCrawlData,
  getCachedSellers,
  getDateNDaysAgo,
  getDefault129CheckItems,
  getToday,
  getYesterday,
  inArray,
  invokeLLM,
  isNull,
  keywordMonitors,
  keywordSnapshots,
  lingxingProductWeekly,
  mergeSellerSpriteWithCrawlData,
  operatorNameMappings,
  opsImportHistory,
  opsPlanActions,
  opsPlanSummaries,
  opsPlans,
  or,
  parseSellerSpriteData,
  parseSellerSpriteXlsx,
  productBasicInfo,
  productLogs,
  productMonthlySummary,
  productProfiles,
  productTodos,
  productVariants,
  productWeeklyOps,
  protectedProcedure,
  resolveDataUserId,
  round2,
  router,
  scoreAllCheckItems,
  scoringProgressMap,
  sql,
  teamTasks,
  users,
  z,
} = shared;
const getDb = (...args: Parameters<typeof shared.getDb>) => shared.getDb(...args);

export const opsImportProcedures = {


  // ============== SellerSprite Import ==============

  /** 解析卖家精灵导出的CSV文本，返回解析结果预览（向后兼容） */
  parseSellerSpriteCSV: protectedProcedure
    .input(z.object({
      csvText: z.string().min(10, '文件内容不能为空'),
      targetAsin: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = parseSellerSpriteData(input.csvText, input.targetAsin);
      return result;
    }),


  /** 解析卖家精灵导出的xlsx文件（base64编码），返回解析结果预览 */
  parseSellerSpriteXlsx: protectedProcedure
    .input(z.object({
      /** xlsx文件的base64编码内容 */
      fileBase64: z.string().min(10, '文件内容不能为空'),
      /** 原始文件名（用于辅助判断文件类型） */
      fileName: z.string().optional(),
      targetAsin: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, 'base64');
      const result = parseSellerSpriteXlsx(buffer, input.targetAsin);
      // 如果文件名包含特征词，辅助修正文件类型
      if (input.fileName) {
        const fn = input.fileName.toLowerCase();
        if (fn.includes('reverseasin') && result.fileType !== 'keyword') {
          // 文件名明确是反查ASIN，但列名检测可能失败
          if (result.keywords.length === 0 && result.parsedRows === 0) {
            // 重新尝试按关键词解析
            const retryResult = parseSellerSpriteXlsx(buffer, input.targetAsin);
            if (retryResult.keywords.length > 0) return retryResult;
          }
        }
        if (fn.includes('review') && result.fileType !== 'review') {
          if (result.reviews.length === 0 && result.parsedRows === 0) {
            const retryResult = parseSellerSpriteXlsx(buffer, input.targetAsin);
            if (retryResult.reviews.length > 0) return retryResult;
          }
        }
      }
      return result;
    }),


  /** 将卖家精灵数据应用到转化率对比的评分中（补充爬虫缺失的数据） */
  applySellerSpriteData: protectedProcedure
    .input(z.object({
      comparisonId: z.number(),
      asin: z.string(),
      productData: z.object({
        title: z.string().optional(),
        brand: z.string().optional(),
        category: z.string().optional(),
        categoryPath: z.string().optional(),
        bsrRank: z.number().optional(),
        subCategoryRank: z.number().optional(),
        price: z.number().optional(),
        primePrice: z.number().optional(),
        rating: z.number().optional(),
        reviewCount: z.number().optional(),
        monthlySales: z.number().optional(),
        monthlyRevenue: z.number().optional(),
        variationCount: z.number().optional(),
        fulfillment: z.string().optional(),
        imageCount: z.number().optional(),
        bulletPoints: z.array(z.string()).optional(),
        description: z.string().optional(),
        lqs: z.number().optional(),
        qaCount: z.number().optional(),
        coupon: z.string().optional(),
        launchDate: z.string().optional(),
        listingAge: z.number().optional(),
        sellerCount: z.number().optional(),
        fbaFee: z.number().optional(),
        grossMargin: z.number().optional(),
        // 标签
        hasBestSeller: z.boolean().optional(),
        hasAmazonChoice: z.boolean().optional(),
        hasNewRelease: z.boolean().optional(),
        hasAplus: z.boolean().optional(),
        hasVideo: z.boolean().optional(),
        hasSPAd: z.boolean().optional(),
        hasBrandStory: z.boolean().optional(),
        hasBrandAd: z.boolean().optional(),
        hasCPFGreen: z.boolean().optional(),
        acKeyword: z.string().optional(),
        // 卖家信息
        buyboxSeller: z.string().optional(),
        buyboxType: z.string().optional(),
        sellerLocation: z.string().optional(),
        // 物流尺寸
        productWeight: z.string().optional(),
        productDimensions: z.string().optional(),
        packageWeight: z.string().optional(),
        packageDimensions: z.string().optional(),
        packageSizeTier: z.string().optional(),
      }),
      keywordData: z.array(z.object({
        keyword: z.string(),
        keywordTranslation: z.string().optional(),
        searchVolume: z.number().optional(),
        organicRank: z.number().optional(),
        adRank: z.number().optional(),
        ppcBid: z.number().optional(),
        spr: z.number().optional(),
        titleDensity: z.number().optional(),
        trafficShare: z.number().optional(),
        abaWeeklyRank: z.number().optional(),
      })).optional(),
      reviewData: z.array(z.object({
        title: z.string().optional(),
        content: z.string(),
        rating: z.number(),
        isVerified: z.boolean().optional(),
        isVineVoice: z.boolean().optional(),
        variant: z.string().optional(),
        date: z.string().optional(),
        helpfulVotes: z.number().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库连接失败' });
      const { comparisonId, asin, productData, keywordData, reviewData } = input;
      const upperAsin = asin.toUpperCase();

      // Step 1: 将卖家精灵数据转换为 ConversionCrawlData 格式
      const crawlData = buildCrawlDataFromSellerSprite(
        upperAsin,
        productData as any,
        keywordData as any,
        reviewData as any,
      );

      // Step 2: 保存卖家精灵原始数据到对比记录的crawlData中（先保存数据）
      const comparison = await db.select().from(conversionComparisons)
        .where(eq(conversionComparisons.id, comparisonId))
        .limit(1);

      if (comparison.length > 0) {
        const existingCrawl = comparison[0].crawlData ? JSON.parse(comparison[0].crawlData as string) : {};
        if (!existingCrawl[upperAsin]) existingCrawl[upperAsin] = crawlData;
        else {
          for (const [catName, catData] of Object.entries(crawlData.categories)) {
            if (catData && typeof catData === 'object') {
              existingCrawl[upperAsin].categories = existingCrawl[upperAsin].categories || {};
              existingCrawl[upperAsin].categories[catName] = {
                ...existingCrawl[upperAsin].categories[catName],
                ...catData,
              };
            }
          }
          existingCrawl[upperAsin].hasData = true;
        }
        if (!existingCrawl.sellerSpriteData) existingCrawl.sellerSpriteData = {};
        existingCrawl.sellerSpriteData[upperAsin] = {
          productData,
          keywordData,
          reviewData,
          importedAt: Date.now(),
        };
        await db.update(conversionComparisons)
          .set({ crawlData: JSON.stringify(existingCrawl) })
          .where(eq(conversionComparisons.id, comparisonId));
      }

      // Step 3: 设置评分进度跟踪
      const taskKey = `scoring_${comparisonId}_${upperAsin}`;
      scoringProgressMap.set(taskKey, { status: 'running', scored: 0, total: 0, message: '正在准备评分...' });

      // Step 4: 启动异步评分（不等待完成，立即返回）
      (async () => {
        try {
          const checkItems = await db.select().from(conversionCheckItems)
            .where(isNull(conversionCheckItems.userId))
            .orderBy(asc(conversionCheckItems.categoryIndex), asc(conversionCheckItems.sortOrder));

          const existingScores = await db.select().from(conversionScores)
            .where(and(
              eq(conversionScores.comparisonId, comparisonId),
              eq(conversionScores.asin, upperAsin),
            ));
          const lockedKeys = new Set(
            existingScores.filter(s => s.isLocked === 1).map(s => s.checkItemId)
          );

          await db.delete(conversionScores)
            .where(and(
              eq(conversionScores.comparisonId, comparisonId),
              eq(conversionScores.asin, upperAsin),
              eq(conversionScores.isLocked, 0),
            ));

          const unlocked = checkItems.filter(item => !lockedKeys.has(item.id));
          console.log(`[applySellerSpriteData] Async scoring ${unlocked.length} items for ${upperAsin} (${lockedKeys.size} locked)`);
          scoringProgressMap.set(taskKey, { status: 'running', scored: 0, total: unlocked.length, message: `正在评分 0/${unlocked.length} 项...` });

          const scores = await scoreAllCheckItems(
            unlocked.map(item => ({
              id: item.id,
              categoryName: item.categoryName,
              subDimension: item.subDimension || "",
              standard: item.standard || "",
              categoryIndex: item.categoryIndex,
              sortOrder: item.sortOrder || 0,
            })),
            crawlData,
            (scored, total) => {
              scoringProgressMap.set(taskKey, { status: 'running', scored, total, message: `正在评分 ${scored}/${total} 项...` });
            }
          );

          let scoredCount = 0;
          let noDataCount = 0;
          for (const s of scores) {
            await db.insert(conversionScores).values({
              comparisonId,
              checkItemId: s.checkItemId,
              asin: upperAsin,
              score: s.score,
              aiScore: s.score,
              reason: s.reason,
              aiReason: s.reason,
              rawData: s.rawData,
              source: s.source === 'no_data' ? 'no_data' : (s.source === 'programmatic' ? 'programmatic' : 'ai'),
            });
            if (s.score !== null && s.score > 0) scoredCount++;
            else noDataCount++;
          }

          // 更新整体评分
          const allOwnScores = await db.select().from(conversionScores)
            .where(and(eq(conversionScores.comparisonId, comparisonId), eq(conversionScores.asin, upperAsin)));
          const validScores = allOwnScores.filter(s => s.score !== null && s.score > 0);
          const avgScore = validScores.length > 0
            ? Math.round(validScores.reduce((sum, s) => sum + (s.score || 0), 0) / validScores.length * 10) / 10
            : 0;

          if (comparison.length > 0 && comparison[0].ownAsin === upperAsin) {
            await db.update(conversionComparisons).set({
              overallOwnScore: String(avgScore),
            }).where(eq(conversionComparisons.id, comparisonId));
          }

          scoringProgressMap.set(taskKey, {
            status: 'done',
            scored: scoredCount,
            total: scores.length,
            message: `评分完成：${scoredCount}项已评分，${noDataCount}项无数据，平均分${avgScore}`,
          });
          console.log(`[applySellerSpriteData] Async scoring done: ${scoredCount} scored, ${noDataCount} no_data`);

          // 5分钟后清理进度缓存
          setTimeout(() => scoringProgressMap.delete(taskKey), 5 * 60 * 1000);
        } catch (err: any) {
          console.error(`[applySellerSpriteData] Async scoring error:`, err);
          scoringProgressMap.set(taskKey, {
            status: 'error',
            scored: 0,
            total: 0,
            message: `评分失败：${err.message?.substring(0, 100)}`,
          });
          setTimeout(() => scoringProgressMap.delete(taskKey), 5 * 60 * 1000);
        }
      })();

      return {
        success: true,
        taskKey,
        message: `卖家精灵数据已保存，AI评分已在后台启动...`,
      };
    }),


  // ═══════════════════════════════════════════════════════
  // ─── Ops Plan Batch Import: Template Download & Import ───
  // ═══════════════════════════════════════════════════════

  /** Generate Excel template with user's product parent ASINs pre-filled */
  downloadPlanTemplate: protectedProcedure
    .input(z.object({
      marketplace: z.string().default("ALL"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      // Get distinct parent ASINs with latest product info
      const allRows = await db!.select({
        parentAsin: lingxingProductWeekly.parentAsin,
        title: lingxingProductWeekly.title,
        productName: lingxingProductWeekly.productName,
        storeName: lingxingProductWeekly.storeName,
        operator: lingxingProductWeekly.operator,
        country: lingxingProductWeekly.country,
        weekStartDate: lingxingProductWeekly.weekStartDate,
      })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, effectiveUserId))
        .orderBy(desc(lingxingProductWeekly.weekStartDate));

      // Filter by marketplace
      const filtered = input.marketplace === "ALL" ? allRows : allRows.filter((r: any) => {
        const c = (r.country || "").toUpperCase();
        return c === input.marketplace || c.includes(input.marketplace);
      });

      // Deduplicate by parentAsin, keep latest row
      const asinMap = new Map<string, any>();
      for (const row of filtered) {
        const key = row.parentAsin ?? '';
        if (key && !asinMap.has(key)) asinMap.set(key, row);
      }

      // Apply operator permission filter for non-admin users
      const { MANAGER_ROLES } = await import("../../../../shared/const");
      const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      let products = Array.from(asinMap.values());
      if (!isManagerOrAbove && ctx.user.name) {
        // Apply operator name mapping
        const mappings = await db!.select().from(operatorNameMappings)
          .where(eq(operatorNameMappings.userId, effectiveUserId));
        const nameMap = new Map(mappings.map((m: any) => [m.externalName, m.systemUserName]));
        products = products.filter((p: any) => {
          const mappedName = nameMap.get(p.operator) || p.operator;
          return mappedName === ctx.user.name;
        });
      }

      // Check existing plans for these ASINs
      const existingPlans = await db!.select().from(opsPlans)
        .where(eq(opsPlans.userId, ctx.user.id));
      const plansByProfileId = new Map<number, any>();
      for (const p of existingPlans) {
        plansByProfileId.set(p.productProfileId, p);
      }

      // Build template rows
      const templateRows = products.map((p: any) => ({
        "父ASIN": p.parentAsin,
        "产品标题": p.title || p.productName || "",
        "店铺": p.storeName || "",
        "运营": p.operator || "",
        "计划名称": `${p.parentAsin} 运营计划`,
        "计划周期": "",
        "项目经理": "",
        "游戏策划师": "",
        "目标-销售额": "",
        "目标-小类排名": "",
        "目标-利润率(%)": "",
        "目标-转化率(%)": "",
        "目标-自然订单": "",
        "目标-广告订单": "",
        "目标-评分": "",
        "目标-评论数": "",
        "提升目标/动作": "",
      }));

      // Generate Excel using xlsx
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(templateRows);

      // Set column widths
      ws["!cols"] = [
        { wch: 14 }, // 父ASIN
        { wch: 40 }, // 产品标题
        { wch: 12 }, // 店铺
        { wch: 10 }, // 运营
        { wch: 25 }, // 计划名称
        { wch: 12 }, // 计划周期
        { wch: 10 }, // 项目经理
        { wch: 12 }, // 游戏策划师
        { wch: 14 }, // 目标-销售额
        { wch: 14 }, // 目标-小类排名
        { wch: 14 }, // 目标-利润率
        { wch: 14 }, // 目标-转化率
        { wch: 14 }, // 目标-自然订单
        { wch: 14 }, // 目标-广告订单
        { wch: 10 }, // 目标-评分
        { wch: 12 }, // 目标-评论数
        { wch: 20 }, // 提升目标/动作
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "运营计划");

      // Add instructions sheet with validation rules
      const instrRows = [
        { "说明": "═══ 使用说明 ═══" },
        { "说明": "" },
        { "说明": "【必填字段】" },
        { "说明": "• 父ASIN：已自动填充，请勿修改（格式：B0开头的10位字母数字）" },
        { "说明": "• 计划名称：必填，建议格式如\"B0XXXXXX 2026Q2运营计划\"" },
        { "说明": "" },
        { "说明": "【选填字段】" },
        { "说明": "• 计划周期：建议格式 \"2026Q2\"、\"2026年4月-6月\"、\"2026W16-W20\"" },
        { "说明": "• 项目经理：填写负责人姓名" },
        { "说明": "• 游戏策划师：填写策划师姓名" },
        { "说明": "" },
        { "说明": "【数据校验规则】" },
        { "说明": "1. 父ASIN不能为空，且必须与系统中已导入的产品匹配" },
        { "说明": "2. 计划名称不能为空，长度不超过100个字符" },
        { "说明": "3. 计划周期建议使用统一格式，便于后续筛选和排序" },
        { "说明": "4. 如果该ASIN已有运营计划，导入时将自动更新现有计划" },
        { "说明": "" },
        { "说明": "【基线/目标数据说明】" },
        { "说明": "基线数据无需在模板中填写，在系统中创建计划后选择基线周度自动加载" },
        { "说明": "目标数据可在模板中直接填写，包括：" },
        { "说明": "• 目标-销售额：填写数字，如 5000" },
        { "说明": "• 目标-小类排名：填写整数，如 50" },
        { "说明": "• 目标-利润率(%)：填写百分比数字，如 15.5" },
        { "说明": "• 目标-转化率(%)：填写百分比数字，如 12.3" },
        { "说明": "• 目标-自然订单：填写整数，如 100" },
        { "说明": "• 目标-广告订单：填写整数，如 50" },
        { "说明": "• 目标-评分：填写小数，如 4.5" },
        { "说明": "• 目标-评论数：填写整数，如 200" },
        { "说明": "• 提升目标/动作：填写文本描述" },
      ];
      const instrWs = XLSX.utils.json_to_sheet(instrRows);
      instrWs["!cols"] = [{ wch: 70 }];
      XLSX.utils.book_append_sheet(wb, instrWs, "使用说明");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = Buffer.from(buf).toString("base64");

      return {
        fileName: `运营计划模板_${products.length}个产品_${new Date().toISOString().slice(0, 10)}.xlsx`,
        base64Data: base64,
        productCount: products.length,
      };
    }),


  /** Parse and import ops plans from uploaded Excel */
  importPlansFromExcel: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const XLSX = await import("xlsx");

      // Parse Excel
      const buf = Buffer.from(input.fileData, "base64");
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets["运营计划"] || wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new TRPCError({ code: "BAD_REQUEST", message: "未找到\"运营计划\"工作表" });

      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "表格中没有数据行" });

      // Validate required fields
      const results: { parentAsin: string; planName: string; status: "created" | "updated" | "skipped"; reason?: string }[] = [];

      // Get existing plans for this user
      const existingPlans = await db!.select().from(opsPlans)
        .where(eq(opsPlans.userId, ctx.user.id));

      // Get productProfiles for this user to find productProfileId by parentAsin
      const profiles = await db!.select().from(productProfiles)
        .where(eq(productProfiles.userId, ctx.user.id));
      const profileByAsin = new Map(profiles.map((p: any) => [p.parentAsin, p]));

      // Also check plans with productProfileId=0 (import mode plans)
      const importModePlans = existingPlans.filter((p: any) => p.productProfileId === 0);

      for (const row of rows) {
        const parentAsin = String(row["父ASIN"] || "").trim();
        const planName = String(row["计划名称"] || "").trim();

        if (!parentAsin) {
          results.push({ parentAsin: "(空)", planName, status: "skipped", reason: "缺少父ASIN" });
          continue;
        }
        if (!planName) {
          results.push({ parentAsin, planName: "(空)", status: "skipped", reason: "缺少计划名称（必填）" });
          continue;
        }
        if (planName.length > 100) {
          results.push({ parentAsin, planName: planName.slice(0, 20) + "...", status: "skipped", reason: "计划名称超过100字符限制" });
          continue;
        }

        // Parse numeric fields
        const parseNum = (v: any) => {
          if (v === undefined || v === null || v === "") return null;
          const n = Number(v);
          return isNaN(n) ? null : n;
        };
        const parseStr = (v: any) => {
          if (v === undefined || v === null || v === "") return null;
          return String(v);
        };

        const planData: any = {
          planName,
          planPeriod: parseStr(row["计划周期"]),
          projectManager: parseStr(row["项目经理"]),
          gamePlanner: parseStr(row["游戏策划师"]),
          // 基线数据在系统中选择周度自动加载，不从模板解析
          // 目标数据从模板解析
          targetSales: parseNum(row["目标-销售额"]),
          targetSubcategoryRank: parseNum(row["目标-小类排名"]),
          targetProfitRate: parseNum(row["目标-利润率(%)"]),
          targetConvRate: parseNum(row["目标-转化率(%)"]),
          targetOrganicOrders: parseNum(row["目标-自然订单"]),
          targetAdOrders: parseNum(row["目标-广告订单"]),
          targetRatingScore: parseNum(row["目标-评分"]),
          targetRatingCount: parseNum(row["目标-评论数"]),
          targetAction: parseStr(row["提升目标/动作"]),
        };

        // Clean null values
        const cleanData: Record<string, any> = {};
        for (const [k, v] of Object.entries(planData)) {
          if (v !== null && v !== undefined) cleanData[k] = v;
        }

        // Determine productProfileId
        const profile = profileByAsin.get(parentAsin);
        const productProfileId = profile ? profile.id : 0;

        // Check if plan already exists for this ASIN
        const existingPlan = existingPlans.find((p: any) => {
          // Match by parentAsin first (most reliable)
          if (p.parentAsin === parentAsin) return true;
          if (profile && p.productProfileId === profile.id) return true;
          // For import mode: match by planName containing parentAsin
          if (p.productProfileId === 0 && p.planName.includes(parentAsin)) return true;
          return false;
        });

        try {
          if (existingPlan) {
            // Update existing plan - also set parentAsin for data isolation
            await db!.update(opsPlans).set({ ...cleanData, parentAsin })
              .where(and(eq(opsPlans.id, existingPlan.id), eq(opsPlans.userId, ctx.user.id)));
            results.push({ parentAsin, planName, status: "updated" as const });
          } else {
            // Create new plan with parentAsin for data isolation
            const [insertResult] = await db!.insert(opsPlans).values({
              userId: ctx.user.id,
              productProfileId,
              parentAsin,
              planName,
              ...cleanData,
            } as any);
            results.push({ parentAsin, planName, status: "created" as const });
          }
        } catch (err: any) {
          results.push({ parentAsin, planName, status: "skipped", reason: err.message?.slice(0, 100) });
        }
      }

      // Record import history
      const createdCount = results.filter(r => r.status === "created").length;
      const updatedCount = results.filter(r => r.status === "updated").length;
      const recordIds = results.filter((r: any) => r.recordId).map((r: any) => r.recordId);
      const parentAsinSet = Array.from(new Set(results.filter(r => r.status !== "skipped").map(r => r.parentAsin)));
      try {
        await db!.insert(opsImportHistory).values({
          userId: ctx.user.id,
          importType: "plan",
          fileName: input.fileName,
          totalCount: rows.length,
          createdCount,
          updatedCount,
          skippedCount: results.filter(r => r.status === "skipped").length,
          recordIds: JSON.stringify(recordIds),
          parentAsins: JSON.stringify(parentAsinSet),
        });
      } catch (e) { /* ignore history recording errors */ }

      return {
        total: rows.length,
        created: createdCount,
        updated: updatedCount,
        skipped: results.filter(r => r.status === "skipped").length,
        details: results,
      };
    }),


  // ─── Execution Review Excel Import ───────────────────────────

  /** Download execution review template Excel */
  downloadReviewTemplate: protectedProcedure
    .input(z.object({
      marketplace: z.string().default("ALL"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      // Get distinct parent ASINs with latest product info
      const allRows = await db!.select({
        parentAsin: lingxingProductWeekly.parentAsin,
        title: lingxingProductWeekly.title,
        productName: lingxingProductWeekly.productName,
        storeName: lingxingProductWeekly.storeName,
        operator: lingxingProductWeekly.operator,
        country: lingxingProductWeekly.country,
        weekStartDate: lingxingProductWeekly.weekStartDate,
      })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, effectiveUserId))
        .orderBy(desc(lingxingProductWeekly.weekStartDate));

      // Filter by marketplace
      const filtered = input.marketplace === "ALL" ? allRows : allRows.filter((r: any) => {
        const c = (r.country || "").toUpperCase();
        return c === input.marketplace || c.includes(input.marketplace);
      });

      // Deduplicate by parentAsin, keep latest row
      const asinMap = new Map<string, any>();
      for (const row of filtered) {
        const key = row.parentAsin ?? "";
        if (!asinMap.has(key)) asinMap.set(key, row);
      }

      // Apply operator permission filter for non-admin users
      const { MANAGER_ROLES } = await import("../../../../shared/const");
      const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      let products = Array.from(asinMap.values());
      if (!isManagerOrAbove && ctx.user.name) {
        const mappings = await db!.select().from(operatorNameMappings)
          .where(eq(operatorNameMappings.userId, effectiveUserId));
        const nameMap = new Map(mappings.map((m: any) => [m.externalName, m.systemUserName]));
        products = products.filter((p: any) => {
          const mappedName = nameMap.get(p.operator) || p.operator;
          return mappedName === ctx.user.name;
        });
      }

      // Build template rows
      const templateRows = products.map((p: any) => ({
        "父ASIN": p.parentAsin,
        "产品标题": p.title || p.productName || "",
        "店铺": p.storeName || "",
        "运营": p.operator || "",
        "复盘周期": "",
        "周期类型": "weekly",
        // Review content only - baseline/target/actual data loaded from system
        "成果摘要": "",
        "关键动作": "",
        "经验教训": "",
        "下期计划": "",
      }));

      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(templateRows);

      // Set column widths
      ws["!cols"] = [
        { wch: 14 }, // 父ASIN
        { wch: 40 }, // 产品标题
        { wch: 12 }, // 店铺
        { wch: 10 }, // 运营
        { wch: 16 }, // 复盘周期
        { wch: 10 }, // 周期类型
        { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 35 }, // 复盘内容
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "执行复盘");

      // Add instructions sheet with validation rules
      const instrRows = [
        { "说明": "═══ 使用说明 ═══" },
        { "说明": "" },
        { "说明": "【必填字段】" },
        { "说明": "• 父ASIN：已自动填充，请勿修改（格式：B0开头的10位字母数字）" },
        { "说明": "• 复盘周期：必填，建议格式：\"2026W16\"、\"2026年4月\"、\"2026Q2\"" },
        { "说明": "" },
        { "说明": "【选填字段】" },
        { "说明": "• 周期类型：weekly(周)、monthly(月)、quarterly(季)，默认weekly" },
        { "说明": "• 成果摘要：本周期的主要成果和达成情况" },
        { "说明": "• 关键动作：本周期执行的关键运营动作" },
        { "说明": "• 经验教训：本周期总结的经验和教训" },
        { "说明": "• 下期计划：下一周期的运营计划和目标" },
        { "说明": "" },
        { "说明": "【数据校验规则】" },
        { "说明": "1. 父ASIN不能为空，且必须与系统中已导入的产品匹配" },
        { "说明": "2. 复盘周期不能为空，建议使用统一格式（如 2026W16）" },
        { "说明": "3. 周期类型只能填 weekly/monthly/quarterly，其他值将被跳过" },
        { "说明": "4. 同一ASIN+同一复盘周期的记录将自动更新（而非重复创建）" },
        { "说明": "" },
        { "说明": "【基线/目标/实际数据说明】" },
        { "说明": "这些数据无需在模板中填写，在系统中创建复盘后：" },
        { "说明": "• 进入产品详情页 → 执行复盘Tab → 选择基线/目标周度自动加载历史数据" },
        { "说明": "• 实际数据在复盘详情中选择实际周度自动加载" },
      ];
      const instrWs = XLSX.utils.json_to_sheet(instrRows);
      instrWs["!cols"] = [{ wch: 70 }];
      XLSX.utils.book_append_sheet(wb, instrWs, "使用说明");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = Buffer.from(buf).toString("base64");

      return {
        fileName: `执行复盘模板_${products.length}个产品_${new Date().toISOString().slice(0, 10)}.xlsx`,
        base64Data: base64,
        productCount: products.length,
      };
    }),


  /** Parse and import execution reviews from uploaded Excel */
  importReviewsFromExcel: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const XLSX = await import("xlsx");

      // Parse Excel
      const buf = Buffer.from(input.fileData, "base64");
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets["执行复盘"] || wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new TRPCError({ code: "BAD_REQUEST", message: '未找到"执行复盘"工作表' });

      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "表格中没有数据行" });

      const results: { parentAsin: string; period: string; status: "created" | "updated" | "skipped"; reason?: string }[] = [];

      // Get existing reviews for this user
      const existingReviews = await db!.select().from(executionReviews)
        .where(eq(executionReviews.userId, ctx.user.id));

      // Get productProfiles for this user to find productProfileId by parentAsin
      const profiles = await db!.select().from(productProfiles)
        .where(eq(productProfiles.userId, ctx.user.id));
      const profileByAsin = new Map(profiles.map((p: any) => [p.parentAsin, p]));

      for (const row of rows) {
        const parentAsin = String(row["父ASIN"] || "").trim();
        const period = String(row["复盘周期"] || "").trim();

        if (!parentAsin) {
          results.push({ parentAsin: "(空)", period, status: "skipped", reason: "缺少父ASIN" });
          continue;
        }
        if (!period) {
          results.push({ parentAsin, period: "(空)", status: "skipped", reason: "缺少复盘周期（必填，建议格式：2026W16）" });
          continue;
        }
        if (period.length > 50) {
          results.push({ parentAsin, period: period.slice(0, 20) + "...", status: "skipped", reason: "复盘周期超过50字符限制" });
          continue;
        }

        const parseNum = (v: any) => {
          if (v === undefined || v === null || v === "") return undefined;
          const n = Number(v);
          return isNaN(n) ? undefined : n;
        };
        const parseStr = (v: any) => {
          if (v === undefined || v === null || v === "") return undefined;
          return String(v);
        };

        const periodType = (parseStr(row["周期类型"]) || "weekly") as "weekly" | "monthly" | "quarterly";
        if (!["weekly", "monthly", "quarterly"].includes(periodType)) {
          results.push({ parentAsin, period, status: "skipped", reason: `无效周期类型: ${periodType}` });
          continue;
        }

        const profile = profileByAsin.get(parentAsin);
        const productProfileId = profile ? profile.id : 0;

        const reviewData: Record<string, any> = {
          period,
          periodType,
          parentAsin,
          // Baseline/Target/Actual data: loaded from system when creating review, not from Excel
          // Review content only
          achievementSummary: parseStr(row["成果摘要"]),
          keyActions: parseStr(row["关键动作"]),
          lessonsLearned: parseStr(row["经验教训"]),
          nextPeriodPlan: parseStr(row["下期计划"]),
        };

        // Clean undefined values
        const cleanData: Record<string, any> = {};
        for (const [k, v] of Object.entries(reviewData)) {
          if (v !== undefined) cleanData[k] = v;
        }

        // Check if review already exists for this ASIN + period
        const existingReview = existingReviews.find((r: any) =>
          r.parentAsin === parentAsin && r.period === period
        );

        try {
          if (existingReview) {
            // Update existing review
            await db!.update(executionReviews).set(cleanData)
              .where(and(eq(executionReviews.id, existingReview.id), eq(executionReviews.userId, ctx.user.id)));
            (results as any[]).push({ parentAsin, period, status: "updated", recordId: existingReview.id });
          } else {
            // Create new review
            const [insertResult] = await db!.insert(executionReviews).values({
              userId: ctx.user.id,
              productProfileId,
              ...cleanData,
            } as any);
            (results as any[]).push({ parentAsin, period, status: "created", recordId: (insertResult as any).insertId });
          }
        } catch (err: any) {
          results.push({ parentAsin, period, status: "skipped", reason: err.message?.slice(0, 100) });
        }
      }

      // Record import history
      const createdCount = results.filter(r => r.status === "created").length;
      const updatedCount = results.filter(r => r.status === "updated").length;
      const recordIds = results.filter((r: any) => r.recordId).map((r: any) => r.recordId);
      const parentAsinSet = Array.from(new Set(results.filter(r => r.status !== "skipped").map(r => r.parentAsin)));
      try {
        await db!.insert(opsImportHistory).values({
          userId: ctx.user.id,
          importType: "review",
          fileName: input.fileName,
          totalCount: rows.length,
          createdCount,
          updatedCount,
          skippedCount: results.filter(r => r.status === "skipped").length,
          recordIds: JSON.stringify(recordIds),
          parentAsins: JSON.stringify(parentAsinSet),
        });
      } catch (e) { /* ignore history recording errors */ }

      return {
        total: rows.length,
        created: createdCount,
        updated: updatedCount,
        skipped: results.filter(r => r.status === "skipped").length,
        details: results,
      };
    }),


  // ─── Import History Management ───────────────────────────────

  /** List import history for plans or reviews */
  listImportHistory: protectedProcedure
    .input(z.object({
      importType: z.enum(["plan", "review"]),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      const history = await db!.select().from(opsImportHistory)
        .where(and(
          eq(opsImportHistory.userId, effectiveUserId),
          eq(opsImportHistory.importType, input.importType),
        ))
        .orderBy(desc(opsImportHistory.createdAt));

      return history.map((h: any) => ({
        ...h,
        recordIds: h.recordIds ? JSON.parse(h.recordIds) : [],
        parentAsins: h.parentAsins ? JSON.parse(h.parentAsins) : [],
      }));
    }),


  /** Delete import history and cascade delete associated records */
  deleteImportHistory: protectedProcedure
    .input(z.object({
      historyId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      // Get the history record
      const [history] = await db!.select().from(opsImportHistory)
        .where(and(
          eq(opsImportHistory.id, input.historyId),
          eq(opsImportHistory.userId, effectiveUserId),
        ));

      if (!history) {
        throw new TRPCError({ code: "NOT_FOUND", message: "导入记录不存在" });
      }

      const recordIds: number[] = history.recordIds ? JSON.parse(history.recordIds) : [];

      // Cascade delete associated records
      if (recordIds.length > 0) {
        if (history.importType === "plan") {
          // Delete plan actions first (foreign key)
          await db!.delete(opsPlanActions)
            .where(inArray(opsPlanActions.planId, recordIds));
          // Delete plan summaries
          await db!.delete(opsPlanSummaries)
            .where(inArray(opsPlanSummaries.planId, recordIds));
          // Delete plans
          await db!.delete(opsPlans)
            .where(and(
              inArray(opsPlans.id, recordIds),
              eq(opsPlans.userId, effectiveUserId),
            ));
        } else if (history.importType === "review") {
          // Delete reviews
          await db!.delete(executionReviews)
            .where(and(
              inArray(executionReviews.id, recordIds),
              eq(executionReviews.userId, effectiveUserId),
            ));
        }
      }

      // Delete the history record itself
      await db!.delete(opsImportHistory)
        .where(eq(opsImportHistory.id, input.historyId));

      return {
        success: true,
        deletedRecords: recordIds.length,
        importType: history.importType,
      };
    }),
};