import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createPool } = require('mysql2/promise');
const fs = require('fs');

async function main() {
  const pool = createPool(process.env.DATABASE_URL);
  
  // Get all parent ASINs from DB
  const [data] = await pool.query('SELECT DISTINCT UPPER(parent_asin) as asin FROM product_profiles');
  const dbAsins = new Set(data.map(r => r.asin));
  
  // Parse the devserver log to get all salesMap ASINs (from the debug log we added)
  const log = fs.readFileSync('.manus-logs/devserver.log', 'utf8');
  const lines = log.split('\n');
  
  // Get the full list of 43 mapped ASINs - we only logged 5 samples
  // Instead, let's check the Fetched profit data log
  const fetchLines = lines.filter(l => l.includes('[listProducts] Fetched profit data'));
  console.log('Fetch logs:', fetchLines.length);
  if (fetchLines.length > 0) {
    console.log('Last fetch:', fetchLines[fetchLines.length - 1]);
  }
  
  // The salesMap debug only shows first 5 entries
  // We need to check if ANY DB ASINs would match the profit API data
  // The profit API returns parentAsin field - let's check what those look like
  
  const sampleLines = lines.filter(l => l.includes('[listProducts] salesMap['));
  const salesAsins = new Set();
  for (const l of sampleLines) {
    const m = l.match(/salesMap\[(\w+)\]/);
    if (m) salesAsins.add(m[1]);
  }
  
  console.log('\nDB unique ASINs:', dbAsins.size);
  console.log('SalesMap sample ASINs:', salesAsins.size);
  
  // Check overlap
  let overlap = 0;
  for (const a of salesAsins) {
    if (dbAsins.has(a)) {
      overlap++;
      console.log('  MATCH:', a);
    }
  }
  console.log('Overlap:', overlap);
  
  // Show some salesMap ASINs
  console.log('\nSalesMap ASINs:', Array.from(salesAsins).join(', '));
  
  // Show some DB ASINs
  const dbArr = Array.from(dbAsins);
  console.log('DB ASINs (first 20):', dbArr.slice(0, 20).join(', '));
  
  // The key question: the MSKU profit API returns 2000 records with 43 unique parentAsins
  // But NONE of those 43 parentAsins match the 202 unique parentAsins in the DB
  // This means the profit API is returning data for DIFFERENT products than what's in the DB
  
  // Possible reasons:
  // 1. The profit API returns data for ALL sellers, but DB products are filtered by user
  // 2. The profit API date range doesn't have data for these products
  // 3. The parentAsin field in the profit API response is different from what we expect
  
  // Let's check: does the profit API have a sid (seller ID) filter?
  // And what's the user_id for the products in DB?
  const [userProducts] = await pool.query('SELECT user_id, COUNT(*) as cnt FROM product_profiles GROUP BY user_id');
  console.log('\nProducts by user_id:', JSON.stringify(userProducts));
  
  await pool.end();
}

main().catch(e => console.error(e));
