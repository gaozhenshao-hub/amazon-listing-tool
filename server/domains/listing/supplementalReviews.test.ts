import {describe,it,expect} from 'vitest';
import {matchReviewAsin,normalizeImportedReview,mergeImportedReviews} from './supplementalReviews';
import {sumVariantPurchases} from '../../../shared/competitorPresentation';
import {parseReviewFile} from '../../reviewParser';
const record={id:1,asin:'B09Y5TQ6B7',rawData:JSON.stringify({research:{variants:[{asin:'B0BMS9CKWG'}]}})};
describe('Listing review supplements',()=>{
 it('matches explicit ASIN, variant and filename without assuming the only project product',()=>{
  expect(matchReviewAsin('B09Y5TQ6B7','reviews.xlsx',[record]).id).toBe(1);
  expect(matchReviewAsin('B0BMS9CKWG','reviews.xlsx',[record]).id).toBe(1);
  expect(matchReviewAsin(undefined,'reviews_B09Y5TQ6B7_2026.xlsx',[record]).id).toBe(1);
  expect(()=>matchReviewAsin(undefined,'reviews.xlsx',[record])).toThrow('无法识别');
  expect(()=>matchReviewAsin('B000000001','reviews.xlsx',[record])).toThrow('未匹配');
 });
 it('rejects ambiguous variant membership',()=>expect(()=>matchReviewAsin('B0BMS9CKWG','a.xlsx',[record,{...record,id:2,asin:'B000000002'}])).toThrow('多个'));
 it('deduplicates repeated files and whitespace regardless of export date formatting',()=>{
  const a=normalizeImportedReview({title:'Good',content:'works well',rating:5,date:'2026-01-01'});
  const b=normalizeImportedReview({title:'Good',content:'works   well',rating:5,date:'Jan 1, 2026'});
  expect(mergeImportedReviews([a],[b])).toHaveLength(1);
 });
 it('parses thousands of comments without truncating to the visible ten',()=>{
  const csv='ASIN,评论内容,星级\n'+Array.from({length:3500},(_,i)=>`B09Y5TQ6B7,Review number ${i},5`).join('\n');
  expect(parseReviewFile(Buffer.from(csv),'reviews.csv').reviews).toHaveLength(3500);
 });
 it('keeps distinct reviewers or dates even when their comments use identical wording',()=>{
  const a=normalizeImportedReview({content:'Good product',author:'Alice',date:'2026-01-01'});
  const b=normalizeImportedReview({content:'Good product',author:'Bob',date:'2026-01-01'});
  const c=normalizeImportedReview({content:'Good product',author:'Alice',date:'2026-02-01'});
  expect(mergeImportedReviews([a],[b,c])).toHaveLength(3);
 });
 it('adds child sales once without counting the parent badge twice',()=>{
  const result=sumVariantPurchases({boughtPastMonth:'100+',variants:[{asin:'B000000001',boughtPastMonth:'100+',status:'collected'},{asin:'B000000002',boughtPastMonth:'50+',status:'collected'},{asin:'B000000002',boughtPastMonth:'50+',status:'collected'},{asin:'B000000003',boughtPastMonth:null,status:'not_fetched'}]} as any,'B000000001');
  expect(result).toMatchObject({value:150,covered:2,total:3,partial:true});
 });
});
