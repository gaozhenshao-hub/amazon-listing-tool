// Test script to inspect the actual fields returned by the Lingxing MSKU profit API
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load env
const dotenv = require('dotenv');
dotenv.config();

// We need to use the LingxingAdapter directly
// Let's just make a direct HTTP call to the server's tRPC endpoint instead
const baseUrl = 'http://localhost:3000';

async function testProfitAPI() {
  try {
    // First, let's read the adapter code to understand the proxy setup
    const fs = require('fs');
    
    // Read the lingxing adapter to find the actual API call
    const adapterCode = fs.readFileSync('./server/lingxingAdapter.ts', 'utf8');
    
    // Look for the profit API path
    const profitMatch = adapterCode.match(/msku\/list/g);
    console.log('Found msku/list references:', profitMatch?.length);
    
    // Let's check the devserver log for the actual API response
    const logPath = './.manus-logs/devserver.log';
    if (fs.existsSync(logPath)) {
      const log = fs.readFileSync(logPath, 'utf8');
      const lines = log.split('\n');
      
      // Find lines with msku/list response
      const mskuLines = lines.filter(l => l.includes('msku/list') && l.includes('status=200'));
      console.log(`\nFound ${mskuLines.length} msku/list API responses in log`);
      
      if (mskuLines.length > 0) {
        const lastLine = mskuLines[mskuLines.length - 1];
        const previewMatch = lastLine.match(/preview=(.+)/);
        if (previewMatch) {
          console.log('\nLast MSKU profit API response preview:');
          console.log(previewMatch[1].substring(0, 1000));
          
          // Try to parse and get field names from the first record
          try {
            const preview = previewMatch[1];
            // The preview is truncated, but let's try to extract field names
            const recordsMatch = preview.match(/"records":\[(\{[^}]+)/);
            if (recordsMatch) {
              console.log('\nFirst record partial:', recordsMatch[1]);
              // Extract field names
              const fieldNames = recordsMatch[1].match(/"(\w+)":/g);
              if (fieldNames) {
                console.log('\nField names found in first record:');
                fieldNames.forEach(f => console.log('  -', f.replace(/"/g, '').replace(':', '')));
              }
            }
          } catch (e) {
            console.log('Parse error:', e.message);
          }
        }
      }
      
      // Also check for the First record debug log
      const firstRecordLines = lines.filter(l => l.includes('[listProducts] First record'));
      console.log(`\nFound ${firstRecordLines.length} 'First record' debug log entries`);
      firstRecordLines.forEach(l => console.log(l));
      
      // Check salesMap debug logs
      const salesMapLines = lines.filter(l => l.includes('[listProducts] salesMap'));
      console.log(`\nFound ${salesMapLines.length} salesMap debug entries`);
      salesMapLines.forEach(l => console.log(l));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

testProfitAPI();
