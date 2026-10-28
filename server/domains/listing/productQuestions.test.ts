import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {parseProductQuestions,mergeProductQuestions,matchQuestionBrand} from './productQuestions';
import {parseReviewWorkbook} from '../../reviewParser';
function book(sheets:Record<string,unknown[][]>){const b=XLSX.utils.book_new();for(const [name,rows] of Object.entries(sheets))XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),name);return b;}
describe('Seller exports',()=>{
 it('matches answer brands while excluding similar-product answers and ambiguous products',()=>{
  const q:any=[{type:'alexa',question:'Washable?',answer:'The USKEEPERS suit is washable.'},{type:'alexa',question:'compare with similar',answer:'Humble Bee and HiveSweet'}];
  const records=[{asin:'B000000001',brand:'USKEEPERS'},{asin:'B000000002',brand:'Humble Bee'}];
  expect(matchQuestionBrand(q,records)).toBe('B000000001');
  expect(matchQuestionBrand(q,[...records,{asin:'B000000003',brand:'USKEEPERS'}])).toBeUndefined();
  expect(matchQuestionBrand(q,[{asin:'B000000001',brand:'KEEPERS'}])).toBeUndefined();
 });
 it('pairs translations and answers without importing recommended products',()=>{
  const q=parseProductQuestions(book({'Alexa(1)':[['','提问','回答'],['原文','Washable?','Yes'],['翻译','能清洗吗？','可以']], 'Products(1)':[['问题','ASIN'],['compare','B000000001']], 'Follow-up Questions':[['相关问题'],['How to wash?']],Note:[['help'],['contact support']]}));
  expect(q).toEqual([{type:'alexa',asin:undefined,question:'Washable?',answer:'Yes',questionCn:'能清洗吗？',answerCn:'可以'},{type:'follow_up',asin:undefined,question:'How to wash?'}]);
  expect(mergeProductQuestions(q,q)).toHaveLength(2);
 });
 it('supports explicit ASIN and multiple follow-up columns',()=>{
  const q=parseProductQuestions(book({Data:[['ASIN','问题','Follow up question 1','Follow up question 2'],['B000000001','Washable?','How?','When?']]}));
  expect(q).toHaveLength(3);expect(q[2]).toMatchObject({asin:'B000000001',type:'follow_up',parentQuestion:'Washable?'});
 });
 it('ignores help sheets and preserves SellerSprite review metadata',()=>{
  const rows=parseReviewWorkbook(book({Reviews:[['ASIN','内容','星级','评论人','评论时间','VP评论','赞同数'],['B000000001','Great suit',5,'Alice','2026-10-01','是',3]],Note:[['Support'],['https://example.com/long-help-link-do-not-parse']]}));
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({asin:'B000000001',author:'Alice',date:'2026-10-01',verifiedPurchase:true,helpfulVotes:3});
 });
});
