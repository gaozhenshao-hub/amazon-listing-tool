// Full test: Excel → CSV → parseSellerSpriteData
import { readFileSync } from "fs";
import * as XLSX from "xlsx";

// Import the parser (CommonJS style)
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const filePath = "/home/ubuntu/upload/Search(Gen-Dreadlocks-Machine)-59-US-20260407.xlsx";
const buffer = readFileSync(filePath);

// Convert Excel to CSV (same logic as backend)
const wb = XLSX.read(buffer, { type: "buffer", cellText: true, raw: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const csvText = XLSX.utils.sheet_to_csv(ws, { forceQuotes: true });

// Dynamically import the TypeScript compiled module
// Since it's TypeScript, we need to use tsx or ts-node
// Instead, let's test the CSV column mapping directly
const lines = csvText.split("\n");
const headerLine = lines[0];

// Parse CSV header to check column names
const parseCSVRow = (line) => {
  const result = [];
  let inQuotes = false;
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
};

const headers = parseCSVRow(headerLine);
console.log("=== Column Headers ===");
headers.forEach((h, i) => console.log(`  ${i}: ${h}`));

// Check key field mappings
const keyFields = {
  "ASIN": headers.indexOf("ASIN"),
  "商品标题": headers.indexOf("商品标题"),
  "品牌": headers.indexOf("品牌"),
  "月销量": headers.indexOf("月销量"),
  "月销售额($)": headers.indexOf("月销售额($)"),
  "价格($)": headers.indexOf("价格($)"),
  "评分": headers.indexOf("评分"),
  "评分数": headers.indexOf("评分数"),
  "大类BSR": headers.indexOf("大类BSR"),
  "小类BSR": headers.indexOf("小类BSR"),
  "FBA($)": headers.indexOf("FBA($)"),
  "毛利率": headers.indexOf("毛利率"),
  "SP广告": headers.indexOf("SP广告"),
  "A+页面": headers.indexOf("A+页面"),
  "Best Seller标识": headers.indexOf("Best Seller标识"),
  "Amazon's Choice": headers.indexOf("Amazon's Choice"),
  "上架时间": headers.indexOf("上架时间"),
  "配送方式": headers.indexOf("配送方式"),
  "产品卖点": headers.indexOf("产品卖点"),
};

console.log("\n=== Key Field Indices ===");
Object.entries(keyFields).forEach(([k, v]) => {
  console.log(`  ${k}: col ${v} ${v === -1 ? "❌ NOT FOUND" : "✅"}`);
});

// Parse first data row
const firstDataRow = parseCSVRow(lines[1]);
console.log("\n=== First Product Data ===");
Object.entries(keyFields).forEach(([k, idx]) => {
  if (idx !== -1) {
    console.log(`  ${k}: ${firstDataRow[idx]}`);
  }
});

console.log("\n=== Summary ===");
console.log(`Total data rows: ${lines.length - 1}`);
const missingFields = Object.entries(keyFields).filter(([, v]) => v === -1).map(([k]) => k);
if (missingFields.length === 0) {
  console.log("✅ All key fields found in the Excel file!");
} else {
  console.log(`❌ Missing fields: ${missingFields.join(", ")}`);
}
