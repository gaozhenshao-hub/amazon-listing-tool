import {afterEach,describe,expect,it,vi} from 'vitest';
import {insertLegacySaihuFacts,loadLegacySaihuFacts,startSaihuSyncScheduler} from './saihuSyncExecutor';
import {legacySaihuAuthorize} from '../../routers/saihuLegacySync';
afterEach(()=>vi.unstubAllEnvs());
describe('merged legacy Saihu compatibility',()=>{
 it('retains explicit daily date and ASIN level absent from the merged ORM',async()=>{
  const query=vi.fn().mockResolvedValue([[]]);const db={query} as any;
  await insertLegacySaihuFacts(db,[{reportDate:'2026-10-16',reportLevel:'asin',workspaceId:1,importId:20,userId:2,asin:'B000000001',salesQty:3}]);
  expect(query.mock.calls[0][0]).toContain('`report_date`,`report_level`');
  expect(query.mock.calls[0][1]).toEqual(['2026-10-16','asin',1,20,2,'B000000001',3]);
  await loadLegacySaihuFacts(db,1);
  expect(query.mock.calls[1][0]).toContain('`report_date` AS `reportDate`');
  expect(query.mock.calls[1][0]).toContain('`report_level` AS `reportLevel`');
  expect(query.mock.calls[1][1]).toEqual([1]);
 });
 it('rejects a daily write without an explicit reporting date',async()=>{
  const query=vi.fn();await expect(insertLegacySaihuFacts({query} as any,[{asin:'B000000001',reportLevel:'asin'}])).rejects.toThrow();expect(query).not.toHaveBeenCalled();
 });
 it('reads only the sync interval or replay import instead of all historical daily data',async()=>{
  const query=vi.fn().mockResolvedValue([[]]);const db={query} as any;
  await loadLegacySaihuFacts(db,1,{start:'2026-10-10',end:'2026-10-16'});
  expect(query.mock.calls[0][0]).toContain('AND report_date BETWEEN ? AND ?');
  expect(query.mock.calls[0][1]).toEqual([1,'2026-10-10','2026-10-16']);
  await loadLegacySaihuFacts(db,1,{importId:23});
  expect(query.mock.calls[1][0]).toContain('AND import_id=?');
  expect(query.mock.calls[1][1]).toEqual([1,23]);
 });
 it.each(['ENABLE_SAIHU_REPORT_SCHEDULER','ENABLE_SAIHU_REPORT_WRITES','ENABLE_MERGED_OPS_INVENTORY_COLLECTION'])('does not start competing writer %s',key=>{
  vi.stubEnv('ENABLE_LEGACY_SAIHU_SYNC','true');vi.stubEnv(key,'true');expect(()=>startSaihuSyncScheduler()).toThrow('SAIHU_SYNC_WRITER_CONFLICT');
 });
 it('is disabled by default',async()=>{vi.stubEnv('ENABLE_LEGACY_SAIHU_SYNC','false');await expect(startSaihuSyncScheduler()()).resolves.toBeUndefined();});
 it.each(['ops_specialist','ops_manager'])('rejects %s schedule edits even with a matching workspace',async role=>{
  const ctx={user:{id:3,role,defaultWorkspaceId:1},workspaceId:1} as any;
  const query=vi.fn().mockResolvedValue([[{id:3,role,status:'active',defaultWorkspaceId:1}]]);
  await expect(legacySaihuAuthorize(ctx,1,true)({query} as any)).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('rejects a forged workspace before reading configurations',async()=>{
  const query=vi.fn();await expect(legacySaihuAuthorize({user:{id:2,role:'admin',defaultWorkspaceId:1}} as any,2)({query} as any)).rejects.toMatchObject({code:'FORBIDDEN'});expect(query).not.toHaveBeenCalled();
 });
});
