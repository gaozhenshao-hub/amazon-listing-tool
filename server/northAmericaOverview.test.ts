import { describe, it, expect } from 'vitest';
import { buildNorthAmericaOverview } from './domains/ops/productOverview/northAmericaOverview';
const row = { id: 1, workspaceId: 1, importId: 1, asin: 'B000000001', parentAsin: 'B000000009', site: 'US', currency: 'USD', storeName: '店-US', reportDate: '2026-10-16', reportLevel: 'asin', salesQty: 10, orderQty: 10, salesAmount: '100', grossProfit: '20', adSpend: '10', adSalesAmount: '50', rating: 4.5, ratingCount: 50 };
describe('product overview US consolidation', () => {
  it('deduplicates reimports before merging countries and keeps US identity and ratings', () => {
    const result = buildNorthAmericaOverview([row, { ...row, id: 2, importId: 2 }, { ...row, id: 3, site: 'CA', storeName: '店-CA', parentAsin: 'CA-PARENT', salesQty: 5, salesAmount: '50', grossProfit: '5', adSpend: '5', adSalesAmount: '10' }, { ...row, id: 4, site: 'MX', storeName: '店-MX', salesQty: 2, salesAmount: '20', grossProfit: '2', adSpend: '1', adSalesAmount: '4' }, { ...row, id: 5, site: 'BR' }], 4);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ parentAsin: row.parentAsin, marketplace: 'US', currency: 'USD', storeName: '店-US', variantCount: 1 });
    expect(result[0].weeks[0]).toMatchObject({ weekStartDate: '2026-10-10', weekEndDate: '2026-10-16', salesQty: 17, salesAmount: 170, orderProfit: 27, adSpend: 16, acos: 25, reviewCount: 50 });
    expect(result[0].weeks[0].profitMargin).toBeCloseTo(27 / 170 * 100);
  });
  it('never labels CAD or missing-currency money as USD', () => {
    for (const currency of ['CAD', '', null]) expect(() => buildNorthAmericaOverview([{ ...row, site: 'CA', currency }], 4)).toThrow('USD');
  });
  it('uses current US parent and does not compare non-adjacent weeks', () => {
    const result = buildNorthAmericaOverview([row, { ...row, id: 2, importId: 2, reportDate: '2026-10-30', parentAsin: 'B000000008' }, { ...row, site: 'CA', parentAsin: 'OTHER' }], 4);
    expect(result).toHaveLength(1); expect(result[0].parentAsin).toBe('B000000008'); expect(result[0].weeks[0].wow).toBeNull();
  });
  it('never mutates source facts', () => {
    const source = [{ ...row }, { ...row, site: 'CA', parentAsin: 'OTHER' }], copy = structuredClone(source);
    buildNorthAmericaOverview(source, 4); expect(source).toEqual(copy);
  });
});
