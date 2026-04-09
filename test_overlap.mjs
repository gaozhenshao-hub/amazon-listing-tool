import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all US active product ASINs from DB
const [dbRows] = await conn.query('SELECT parent_asin FROM product_profiles WHERE marketplace = "US" AND status = "active"');
const dbAsins = new Set(dbRows.map(r => r.parent_asin.toUpperCase()));
console.log(`DB US active ASINs: ${dbAsins.size}`);
console.log(`Sample:`, [...dbAsins].slice(0, 5));

// Also get child ASINs from variants table
const [varRows] = await conn.query(`
  SELECT pv.child_asin, pp.parent_asin 
  FROM product_variants pv 
  JOIN product_profiles pp ON pv.product_id = pp.id 
  WHERE pp.marketplace = "US" AND pp.status = "active"
`);
const childAsins = new Set(varRows.map(r => r.child_asin?.toUpperCase()).filter(Boolean));
console.log(`DB child ASINs: ${childAsins.size}`);
console.log(`Sample:`, [...childAsins].slice(0, 5));

// Check overlap between parent_asin and child_asin in DB
let sameCount = 0;
for (const row of varRows) {
  if (row.child_asin?.toUpperCase() === row.parent_asin?.toUpperCase()) sameCount++;
}
console.log(`\nParent == Child count: ${sameCount}/${varRows.length}`);

await conn.end();
