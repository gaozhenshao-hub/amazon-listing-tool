import { describe, it, expect } from 'vitest';
import { competitorView, sumVariantPurchases, parsePurchaseBadge, translationTexts } from '../../../shared/competitorPresentation';

describe('competitor presentation facts', () => {
  it('adds unique collected child badges without adding the parent again', () => {
    const research: any = { boughtPastMonth: '5K+ bought in past month', variants: [
      { asin: 'B000000001', boughtPastMonth: '50+ bought in past month', status: 'collected' },
      { asin: 'B000000001', boughtPastMonth: '50+ bought in past month', status: 'collected' },
      { asin: 'B000000002', boughtPastMonth: '1.5K+ bought in past month', status: 'collected' },
      { asin: 'B000000003', boughtPastMonth: null, status: 'not_fetched' },
    ] };
    expect(sumVariantPurchases(research, 'B000PARENT')).toEqual({ value: 1550, lowerBound: true, covered: 2, total: 3, partial: true });
  });
  it('keeps missing sales unknown and accepts a standalone product badge', () => {
    expect(sumVariantPurchases(undefined, 'B000000001').value).toBeNull();
    expect(sumVariantPurchases({ variants: [], boughtPastMonth: '50+' } as any, 'B000000001').value).toBe(50);
    expect(parsePurchaseBadge('4.5 out of 5 stars')).toBeNull();
    expect(parsePurchaseBadge('1,000+ bought in past month')?.amount).toBe(1000);
  });
  it('uses the existing structured analysis for positioning and selling points', () => {
    const view = competitorView({ id: 1, rawData: JSON.stringify({ brand: 'Brand', analysis: { summary: { overview: 'Position', coreSellingPoints: ['Existing finding'], strengths: ['Strong'], weaknesses: ['Weak'] } } }) });
    expect(view.sellingPoints).toEqual(['Existing finding']);
    expect(view.overview).toBe('Position');
    expect(view.brand).toBe('Brand');
  });
  it('translates actual displayed variant strings and each review without changing originals', () => {
    const view = competitorView({ id: 1, title: 'Protective suit', rawData: { research: { variants: [{ attributes: ['Large', 'White'] }], reviews: [{ title: 'Great fit', body: 'Works well', date: 'September 1', variant: 'Large' }] } } });
    const texts = translationTexts(view);
    expect(texts).toContain('Large / White');
    expect(texts).toContain('Works well');
    expect(view.title).toBe('Protective suit');
  });
});

it('uses calibrated sales including zero without adding a plus badge',()=>{expect(sumVariantPurchases(undefined,'B000000001',0)).toMatchObject({value:0,lowerBound:false});expect(sumVariantPurchases(undefined,'B000000001',1234).value).toBe(1234);});
