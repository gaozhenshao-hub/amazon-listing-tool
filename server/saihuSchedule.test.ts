import {describe,it,expect} from 'vitest';
import {nextSaihuRun,saihuSyncPeriod,saihuPeriodDays,saihuScheduleInput} from '../shared/saihuSchedule';
import {mapSaihuDailyApi} from './domains/ops/productOverview/saihuDailyApi';
const weekly={kind:'weekly' as const,enabled:true,hour:9,minute:0,weekday:1,monthDay:15};
describe('Saihu delayed reporting schedules',()=>{
 it('runs Monday in Shanghai and covers previous Saturday-Friday',()=>{
  const next=nextSaihuRun(weekly,Date.parse('2026-10-01T00:00:00+08:00'));
  expect(new Date(next).toISOString()).toBe('2026-10-05T01:00:00.000Z');
  expect(saihuSyncPeriod('weekly',next)).toEqual({start:'2026-09-26',end:'2026-10-02'});
  expect(saihuPeriodDays('2026-09-26','2026-10-02')).toHaveLength(7);
 });
 it('does not reschedule the exact same occurrence',()=>{
  expect(new Date(nextSaihuRun(weekly,Date.parse('2026-10-05T01:00:00Z'))).toISOString()).toBe('2026-10-12T01:00:00.000Z');
 });
 it('uses Shanghai date across the UTC date boundary',()=>{
  expect(saihuSyncPeriod('monthly',Date.parse('2026-12-31T16:01:00Z'))).toEqual({start:'2026-12-01',end:'2026-12-31'});
 });
 it('uses previous calendar month on the fifteenth including leap year',()=>{
  expect(saihuSyncPeriod('monthly',Date.parse('2028-03-15T01:00:00Z'))).toEqual({start:'2028-02-01',end:'2028-02-29'});
  expect(new Date(nextSaihuRun({...weekly,kind:'monthly'},Date.parse('2026-10-01T00:00:00Z'))).toISOString()).toBe('2026-10-15T01:00:00.000Z');
 });
 it('retains original period when execution is delayed rather than using current date',()=>{
  const scheduled=Date.parse('2026-10-05T01:00:00Z');
  expect(saihuSyncPeriod('weekly',scheduled).end).toBe('2026-10-02');
 });
 it('never includes an unfinished Friday',()=>{
  expect(saihuSyncPeriod('weekly',Date.parse('2026-10-02T01:00:00Z'))).toEqual({start:'2026-09-19',end:'2026-09-25'});
 });
 it('rejects invalid schedule inputs and date ranges',()=>{
  expect(saihuScheduleInput.safeParse({...weekly,hour:24}).success).toBe(false);
  expect(saihuScheduleInput.safeParse({...weekly,monthDay:31}).success).toBe(false);
  expect(()=>saihuPeriodDays('2026-10-02','2026-09-01')).toThrow();
 });
});
describe('Daily API mapping',()=>{
 const columns=Object.fromEntries(['salesQty','orderQty','salesAmount','grossProfit','adSpend','adCvr'].map(k=>[k,{scale:4}]));
 const row=()=>({currency:'USD',asinList:['B09N16YDCX'],parentAsinList:[],shopInfos:[{shopName:'4店-US',marketplaceName:'美国'}],devNameList:['运营'],operatorNameList:['开发'],fieldsMap:Object.fromEntries(Object.entries({saleNum:'10',orderNum:'8',salePrice:'100',profitPrice:'20',adTotalCost:'5',adConversionRate:'25'}).map(([k,v])=>[k,{currValue:v}]))});
 it('preserves ownership, single-child parent and converts percentages',()=>{
  const r=mapSaihuDailyApi(row(),'2026-09-26',columns);expect(r.parentAsin).toBe('B09N16YDCX');expect(r.operator).toBe('运营');expect(r.adCvr).toBe('0.2500');expect(r.weekEndDate).toBe('2026-10-02');
 });
 it('fails closed on missing money, ambiguous identity and invalid numbers',()=>{
  const a:any=row();a.fieldsMap.profitPrice.currValue=null;expect(()=>mapSaihuDailyApi(a,'2026-09-26',columns)).toThrow();
  expect(()=>mapSaihuDailyApi({...row(),asinList:['B09N16YDCX','B0873C7MQX']},'2026-09-26',columns)).toThrow();
  const b=row();b.fieldsMap.saleNum.currValue='oops';expect(()=>mapSaihuDailyApi(b,'2026-09-26',columns)).toThrow();
 });
});
