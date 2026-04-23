import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all unique operators from lingxing data
const [ops] = await conn.query('SELECT DISTINCT operator FROM lingxing_product_weekly WHERE operator IS NOT NULL AND operator != "" ORDER BY operator');

// Get all mappings
const [maps] = await conn.query('SELECT external_name, system_user_name FROM operator_name_mappings');
const mapDict = {};
maps.forEach(m => mapDict[m.external_name] = m.system_user_name);

console.log('Total unique operators in lingxing data:', ops.length);
let unmapped = 0;
ops.forEach(r => {
  const mapped = mapDict[r.operator];
  if (mapped) {
    // console.log('MAPPED:', r.operator, '->', mapped);
  } else {
    console.log('UNMAPPED:', JSON.stringify(r.operator));
    unmapped++;
  }
});
console.log('Unmapped count:', unmapped);

await conn.end();
