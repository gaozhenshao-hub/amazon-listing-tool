// Test script: Crawl ASIN B0F21JYKNT and analyze data availability
import { collectConversionData } from './server/routers/conversionDataCollector.ts';

const ASIN = 'B0F21JYKNT';

console.log(`\n${'='.repeat(70)}`);
console.log(`  Testing Data Collection for ASIN: ${ASIN}`);
console.log(`${'='.repeat(70)}\n`);

try {
  const startTime = Date.now();
  const result = await collectConversionData(ASIN);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n⏱️  Total collection time: ${elapsed}s`);
  console.log(`📊 hasData: ${result.hasData}`);
  
  // Data source status
  console.log(`\n${'─'.repeat(50)}`);
  console.log('📡 Data Source Status:');
  console.log(`${'─'.repeat(50)}`);
  if (result.dataSourceStatus) {
    for (const [source, status] of Object.entries(result.dataSourceStatus)) {
      const icon = status.success ? '✅' : '❌';
      console.log(`  ${icon} ${source}: ${status.success ? 'SUCCESS' : `FAILED - ${status.error}`}`);
    }
  }
  
  // Category-by-category analysis
  console.log(`\n${'─'.repeat(50)}`);
  console.log('📋 Category Data Analysis (18 categories):');
  console.log(`${'─'.repeat(50)}`);
  
  const categories = result.categories;
  const categoryNames = [
    '标题', '五点', '标', '价格', '限购', '配送', '变体', '产品信息',
    '商品文档', '主图', '流量闭环', '品牌故事', 'A+', 'Video', 'Q&A',
    'Review', '店铺介绍页面', '广告'
  ];
  
  const results = [];
  
  for (const catName of categoryNames) {
    const data = categories[catName];
    if (!data) {
      results.push({ category: catName, status: 'MISSING', details: '类别数据完全缺失', hasData: false });
      continue;
    }
    
    // Analyze each category's data quality
    let hasRealData = false;
    let details = [];
    
    switch (catName) {
      case '标题':
        hasRealData = data.charCount > 0 && data.text?.length > 0;
        details.push(`字数=${data.charCount}, 品牌=${data.brand || '无'}, 含品牌词=${data.hasBrand}`);
        if (data.text) details.push(`标题: "${data.text.substring(0, 80)}..."`);
        break;
      case '五点':
        hasRealData = data.bulletCount > 0;
        details.push(`五点数量=${data.bulletCount}, 平均字数=${data.avgCharCount}, 总字数=${data.totalCharCount}`);
        if (data.bullets?.length > 0) details.push(`首条: "${data.bullets[0]?.substring(0, 60)}..."`);
        break;
      case '标':
        hasRealData = data.totalBadges > 0 || data.hasBestSeller || data.hasAmazonChoice || data.hasPrime;
        details.push(`总标签=${data.totalBadges}, BS=${data.hasBestSeller}, AC=${data.hasAmazonChoice}, Prime=${data.hasPrime}, Deal=${data.hasDeal}, Coupon=${data.hasCoupon}`);
        break;
      case '价格':
        hasRealData = data.currentPrice !== null && data.currentPrice > 0;
        details.push(`当前价=${data.currentPrice}, 原价=${data.listPrice}, 划线=${data.hasStrikethrough}, 折扣=${data.discountPercent}%`);
        details.push(`优惠券=${data.hasCoupon ? data.couponValue : '无'}, S&S=${data.hasSubscribeSave}`);
        break;
      case '限购':
        hasRealData = true; // 限购信息即使为空也是有效数据
        details.push(`限购=${data.hasLimit}, 数量=${data.limitQuantity || '无'}`);
        break;
      case '配送':
        hasRealData = data.isFBA !== null || data.isFBM !== null || data.deliveryDays !== null;
        details.push(`FBA=${data.isFBA}, FBM=${data.isFBM}, 天数=${data.deliveryDays}, Prime=${data.hasPrime}`);
        details.push(`发货方=${data.shipsFrom || '未知'}, 卖家=${data.soldBy || '未知'}`);
        break;
      case '变体':
        hasRealData = data.variantCount > 0;
        details.push(`变体数=${data.variantCount}, 类型=${data.variantTypes?.join(',') || '无'}, 有图=${data.hasImages}`);
        break;
      case '产品信息':
        hasRealData = data.fieldCount > 0;
        details.push(`字段数=${data.fieldCount}, 重量=${data.hasWeight}, 尺寸=${data.hasDimensions}, 材质=${data.hasMaterial}`);
        if (data.fields) details.push(`字段: ${JSON.stringify(data.fields).substring(0, 100)}`);
        break;
      case '商品文档':
        hasRealData = true; // 文档信息即使为空也是有效数据
        details.push(`手册=${data.hasManual}, 认证=${data.hasCertification}, 文档数=${data.documentCount}`);
        break;
      case '主图':
        hasRealData = data.totalImageCount > 0 || data.hasMainImage;
        details.push(`主图=${data.hasMainImage}, 主图数=${data.mainImageCount}, 辅图数=${data.secondaryImageCount}`);
        details.push(`视频数=${data.videoCount}, 总图片=${data.totalImageCount}`);
        if (data.mainImages?.length > 0) details.push(`主图URL: ${data.mainImages[0]?.url?.substring(0, 60)}...`);
        break;
      case '流量闭环':
        hasRealData = true;
        details.push(`新型号=${data.hasNewModel}, 捆绑=${data.hasBundleDeal}, 常买=${data.hasFrequentlyBought}`);
        details.push(`SP广告=${data.hasSponsoredProducts}, 虚拟捆绑=${data.hasVirtualBundle}, 品牌店=${data.hasBrandStoreLink}`);
        break;
      case '品牌故事':
        hasRealData = data.hasBrandStory;
        details.push(`有品牌故事=${data.hasBrandStory}, 推荐=${data.hasRecommendation}, 图片数=${data.imageCount}`);
        if (data.textContent) details.push(`内容: "${data.textContent.substring(0, 60)}..."`);
        break;
      case 'A+':
        hasRealData = data.hasAplus;
        details.push(`有A+=${data.hasAplus}, 模块数=${data.moduleCount}, 对比图=${data.hasComparisonChart}`);
        details.push(`图片数=${data.imageCount}, 视频=${data.hasVideo}`);
        break;
      case 'Video':
        hasRealData = data.videoCount > 0 || data.hasMainVideo;
        details.push(`视频数=${data.videoCount}, 主视频=${data.hasMainVideo}`);
        break;
      case 'Q&A':
        hasRealData = data.questionCount > 0;
        details.push(`问题数=${data.questionCount}`);
        break;
      case 'Review':
        hasRealData = data.rating !== null && data.reviewCount !== null;
        details.push(`评分=${data.rating}, 评论数=${data.reviewCount}, Vine=${data.hasVine}`);
        if (data.ratingDistribution) details.push(`分布: ${JSON.stringify(data.ratingDistribution)}`);
        break;
      case '店铺介绍页面':
        hasRealData = data.feedbackScore !== null || data.hasStorefront;
        details.push(`反馈分=${data.feedbackScore}, 反馈数=${data.feedbackCount}, 店铺=${data.hasStorefront}`);
        details.push(`店名=${data.storeName || '未知'}`);
        break;
      case '广告':
        hasRealData = data.hasCampaigns || data.keywordCount > 0;
        details.push(`有广告=${data.hasCampaigns}, 活动数=${data.campaignCount}, 关键词数=${data.keywordCount}`);
        details.push(`花费=${data.totalSpend}, ACOS=${data.acos}, ROAS=${data.roas}`);
        if (data.topKeywords?.length > 0) details.push(`Top关键词: ${data.topKeywords[0]?.keyword}`);
        break;
    }
    
    const icon = hasRealData ? '✅' : '⚠️';
    console.log(`\n  ${icon} [${catName}] ${hasRealData ? 'HAS DATA' : 'NO DATA / EMPTY'}`);
    for (const d of details) {
      console.log(`     ${d}`);
    }
    
    results.push({ category: catName, status: hasRealData ? 'OK' : 'NO_DATA', details: details.join(' | '), hasData: hasRealData });
  }
  
  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('📊 SUMMARY');
  console.log(`${'='.repeat(70)}`);
  const okCount = results.filter(r => r.hasData).length;
  const failCount = results.filter(r => !r.hasData).length;
  console.log(`  ✅ 有数据: ${okCount}/18 类别`);
  console.log(`  ❌ 无数据: ${failCount}/18 类别`);
  if (failCount > 0) {
    console.log(`  无数据类别: ${results.filter(r => !r.hasData).map(r => r.category).join(', ')}`);
  }
  
  // Output raw data for debugging
  console.log(`\n${'─'.repeat(50)}`);
  console.log('🔍 Raw Data (JSON):');
  console.log(`${'─'.repeat(50)}`);
  console.log(JSON.stringify(result, null, 2));
  
} catch (error) {
  console.error('❌ Fatal error during collection:', error);
}
