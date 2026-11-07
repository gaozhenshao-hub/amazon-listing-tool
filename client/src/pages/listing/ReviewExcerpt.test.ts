import {describe,expect,it} from 'vitest';
import {starFill} from './ReviewExcerpt';

describe('rating display',()=>{
 it.each([[4.1,'empty'],[4.2,'empty'],[4.3,'half'],[4.5,'half'],[4.7,'half'],[4.8,'full'],[4.9,'full'],[5,'full']] as const)('shows %s with the correct fifth star',(rating,expected)=>{
  expect(starFill(rating,5)).toBe(expected); expect(starFill(rating,4)).toBe('full');
 });
 it('does not fill stars for missing scores',()=>expect(starFill(null,1)).toBe('empty'));
});
