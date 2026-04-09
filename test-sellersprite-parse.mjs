// Test script: directly test SellerSprite Excel parsing logic
import { readFileSync } from "fs";
import * as XLSX from "xlsx";

const filePath = "/home/ubuntu/upload/Search(Gen-Dreadlocks-Machine)-59-US-20260407.xlsx";
const buffer = readFileSync(filePath);

// Convert Excel to CSV (same logic as backend)
const wb = XLSX.read(buffer, { type: "buffer", cellText: true, raw: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const csvText = XLSX.utils.sheet_to_csv(ws, { forceQuotes: true });

console.log("=== Excel → CSV Conversion ===");
console.log("Sheet name:", wb.SheetNames[0]);
console.log("CSV length:", csvText.length);
console.log("First 500 chars of CSV:");
console.log(csvText.substring(0, 500));
console.log("\n=== CSV Header Row ===");
const lines = csvText.split("\n");
console.log("Total lines:", lines.length);
console.log("Header:", lines[0].substring(0, 300));
console.log("\n=== Row 2 (first data row) ===");
console.log(lines[1]?.substring(0, 300));
