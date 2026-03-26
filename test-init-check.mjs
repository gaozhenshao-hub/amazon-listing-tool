import { getDb } from './server/db.ts';
import { conversionCheckItems } from './drizzle/schema.ts';
import { isNull, sql, asc } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  
  // Check current count
  const existing = await db.select({ count: sql`count(*)` }).from(conversionCheckItems)
    .where(isNull(conversionCheckItems.userId));
  console.log('Current count:', existing[0]?.count);
  
  if (Number(existing[0]?.count) === 0) {
    console.log('No items found, need to initialize...');
    // Import the function dynamically
    const mod = await import('./server/routers/productOps.ts');
    // We can't call the tRPC procedure directly, so let's just manually insert
    // Actually, let's use a different approach - call the function directly
  }
  
  // Just check the count after page load triggers it
  const items = await db.select().from(conversionCheckItems)
    .where(isNull(conversionCheckItems.userId))
    .orderBy(asc(conversionCheckItems.categoryIndex), asc(conversionCheckItems.sortOrder));
  
  console.log('Total items:', items.length);
  if (items.length > 0) {
    // Show categories
    const cats = {};
    items.forEach(i => {
      cats[i.categoryName] = (cats[i.categoryName] || 0) + 1;
    });
    console.log('Categories:', JSON.stringify(cats, null, 2));
    
    // Show first 3 items with standard
    console.log('\nFirst 3 items:');
    items.slice(0, 3).forEach(i => {
      console.log(`  [${i.categoryName}] ${i.subDimension}: ${i.standard?.substring(0, 80)}...`);
    });
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
