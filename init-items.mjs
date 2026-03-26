import { getDb } from './server/db.ts';
import { conversionCheckItems } from './drizzle/schema.ts';
import { isNull, sql } from 'drizzle-orm';

const items = [];
let order = 1;

// 1. 标题 (10项)
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "可读性", standard: "没有语法错误，逻辑通顺，符合北美用户阅读习惯，避免关键词堆砌，合理使用断句", sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "文字、数字、标点符号规范使用", standard: '数字表达使用阿拉伯数字，字母大小写的统一性，标点符号合理使用，测量单位需完整拼写（6 inches 而不是 6"）', sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "字数", standard: "对应类目要充分使用标题字符数", sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "内容", standard: "包含核心产品卖点、功能、参数及使用场景、特定用户人群", sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "关键词", standard: '确保标题包含1-2个核心关键词（如"power bank"、"portable charger"）', sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "词序", standard: "核心卖点词前置, 使消费者更易抓住重点信息，突出产品重点，强调突出产品优势点", sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "套装产品", standard: "多件商品组合销售，清晰表述pack数量", sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "流量词", standard: "关键词筛选与市场和产品相符合的流量词，长尾词和卖点有机结合", sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "品牌词", standard: "品牌有一定知名度，突出品牌词", sortOrder: order++ });
items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "节日", standard: "加入特定节日词", sortOrder: order++ });

console.log(`Generated ${items.length} items for category 标题`);

async function main() {
  const db = await getDb();
  
  // Check count
  const [{ count }] = await db.select({ count: sql`count(*)` }).from(conversionCheckItems).where(isNull(conversionCheckItems.userId));
  console.log('Current DB count:', count);
  
  if (Number(count) === 0) {
    console.log('DB is empty, the getCheckItems API will auto-initialize on next page visit');
  } else {
    console.log('DB already has items');
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
