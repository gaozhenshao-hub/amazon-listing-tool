import { spawn } from 'node:child_process';
import { SignJWT } from 'jose';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';

const child = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, PORT: '3011', AI_JOB_IN_PROCESS: 'false', ENABLE_LEGACY_SAIHU_SYNC: 'false' }, stdio: 'ignore' });
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const token = await new SignJWT({ openId: 'pwd_2', appId: process.env.VITE_APP_ID || 'staging', name: 'Overview verification' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  async function api(path, input) {
    const response = await fetch('http://127.0.0.1:3011/api/trpc/' + path + '?input=' + encodeURIComponent(JSON.stringify({ json: input })), { headers: { cookie: 'app_session_id=' + token }, signal: AbortSignal.timeout(90000) });
    const body = await response.json();
    if (body.error) throw new Error(path + ': ' + (body.error.json?.message || body.error.message));
    assert.equal(response.status, 200);
    return body.result.data.json ?? body.result.data;
  }
  for (let attempt=0; attempt<60; attempt++) {
    try { await fetch('http://127.0.0.1:3011/health'); break; } catch { if(attempt===59) throw Error('SERVER_START_FAILED'); await new Promise(resolve=>setTimeout(resolve,500)); }
  }
  const products = await api('dataImport.getProductOverviewFromImport', { sourceType: 'saihu', weeks: 4, marketplace: 'ALL', consolidateNorthAmerica: true });
  assert(products.length > 200); assert(products.every(p=>p.marketplace==='US' && p.currency==='USD'));
  assert.equal(new Set(products.map(p=>p.parentAsin)).size, products.length);
  const mappings = await api('operatorMapping.listMappings', undefined);
  assert(Array.isArray(mappings) && mappings.every(row => ['saihu','all'].includes(row.sourceType)));
  const sample = products.find(p => p.parentAsin === 'B0FDKYWQNF');
  assert(sample?.operator, 'SELLFOX_OWNER_MISSING');
  const removed = await fetch('http://127.0.0.1:3011/api/trpc/lingxingSync.status', { headers: { cookie: 'app_session_id=' + token } });
  assert.equal(removed.status, 404, 'RETIRED_CONNECTOR_STILL_REACHABLE');
  console.log(JSON.stringify({ownerMappings:mappings.length,ownerSample:{asin:sample.parentAsin,operator:sample.operator},productsWithOwner:products.filter(p=>p.operator).length,retiredConnectorStatus:removed.status}));
  const financial = await api('northAmericaBoard.get', { expectedWorkspaceId: 1 });
  assert.equal(financial.identity.userId, 2);
  assert.equal(financial.payload.currency, 'USD');
  const monthlySample = financial.payload.products.find(p => p.asin === sample.parentAsin && p.storeName === sample.storeName);
  assert(monthlySample, 'FINANCIAL_PARENT_SCOPE_MISSING');
  const reports = new Map();
  for (const point of Object.values(monthlySample.months)) for (const ref of point.sources) {
    if (reports.has(ref.batchId)) continue;
    const [rows] = await db.execute('SELECT status,payload FROM ops_monthly_profit_imports WHERE workspaceId=1 AND id=?', [ref.batchId]);
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'completed');
    reports.set(ref.batchId, typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload);
  }
  const financialProof = [];
  for (const [month, point] of Object.entries(monthlySample.months)) {
    let total = 0;
    for (const ref of point.sources) {
      const row = reports.get(ref.batchId)[ref.rowIndex];
      assert.equal(row.yearMonth, month);
      assert.equal(row.raw.source, 'sellfox_monthly_api');
      assert(row.financialProfit !== null && Number.isFinite(Number(row.financialProfit)));
      total += Number(row.financialProfit);
    }
    assert(Math.abs(total - point.metrics.financialProfit) < 0.001, 'MONTHLY_FINANCIAL_TOTAL_MISMATCH');
    financialProof.push({ month, profit: point.metrics.financialProfit, sourceRows: point.sources.length });
  }
  console.log(JSON.stringify({ financialSource: 'sellfox_monthly_api', asin: monthlySample.asin, storeName: monthlySample.storeName, financialProof }));
  const period = products.flatMap(p=>p.weeks.map(w=>w.weekStartDate)).sort().at(-1);
  // Independently reconcile latest per-ASIN/country/day winners against the UI totals.
  const [source] = await db.execute(`SELECT SUM(sales_amount) sales,SUM(sales_qty) qty,SUM(gross_profit) profit FROM (
    SELECT sales_amount,sales_qty,gross_profit,ROW_NUMBER() OVER(PARTITION BY asin,store_name,site,report_date ORDER BY import_id DESC,id DESC) rn
    FROM saihu_product_weekly WHERE workspaceId=1 AND week_start_date=? AND report_date IS NOT NULL
    AND site IN ('US','CA','MX','美国','加拿大','墨西哥') AND currency='USD' AND report_level='asin'
  ) r WHERE rn=1`,[period]);
  const totals = products.flatMap(p=>p.weeks.filter(w=>w.weekStartDate===period)).reduce((a,w)=>({sales:a.sales+w.salesAmount,qty:a.qty+w.salesQty,profit:a.profit+w.orderProfit}),{sales:0,qty:0,profit:0});
  for(const key of ['sales','qty','profit']) assert(Math.abs(totals[key]-Number(source[0][key]))<0.001,key+' mismatch');
  const [sheets] = await db.execute("SELECT parent_asin parentAsin,store_name storeName,country,payload FROM ops_cost_sheets WHERE workspace_id=1 ORDER BY id LIMIT 100");
  let checked=0, profits=0; const failures=[];
  for(const sheet of sheets) {
    try {
      const result = await api('productCostsReadOnly.get',{expectedWorkspaceId:1,parentAsin:sheet.parentAsin,storeName:sheet.storeName,country:sheet.country});
      assert.equal(result.status,'saved');
      const saved = typeof sheet.payload==='string' ? JSON.parse(sheet.payload) : sheet.payload;
      assert.deepEqual(result.saved.payload,saved); checked++;
      profits += result.rows.filter(row=>row.profit).length;
    } catch(error) { failures.push({asin:sheet.parentAsin,error:error.message}); }
  }
  console.log(JSON.stringify({products:products.length,period,totals,savedSheets:sheets.length,checked,profitCells:profits,failures}));
  assert.equal(failures.length,0); assert(profits>0);
  console.log('OVERVIEW_USD_AND_SAVED_COSTS_VERIFIED');
} finally { await db.end(); child.kill('SIGTERM'); const shutdown = setTimeout(() => child.kill('SIGKILL'), 5000); await new Promise(resolve => child.once('exit', resolve)); clearTimeout(shutdown); }
