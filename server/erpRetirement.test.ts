import { describe, expect, it } from 'vitest';
import { displaySaihuOwner, selectSaihuOwnerMappings } from './domains/ops/saihuOwnerMapping';
import { ApiConnectionCodeSchema } from './domains/apiConnections/contracts';
import { readFileSync, existsSync } from 'node:fs';
const mapping = (sourceType:string, systemUserName:string, isConfirmed=1) => ({sourceType,systemUserName,externalName:'采购员',isConfirmed});
describe('Sellfox-only ERP ownership and retired remote integration',()=>{
  it('never uses Lingxing mappings even for the same external name',()=>{
    expect(displaySaihuOwner('采购员',[mapping('lingxing','错误负责人')])).toBe('采购员');
    expect(selectSaihuOwnerMappings([mapping('lingxing','错误负责人')],'采购员')).toEqual([]);
  });
  it('uses confirmed Sellfox mapping ahead of a generic mapping regardless of row order',()=>{
    for(const rows of [[mapping('all','旧负责人'),mapping('saihu','当前负责人')],[mapping('saihu','当前负责人'),mapping('all','旧负责人')]]) expect(displaySaihuOwner('采购员',rows)).toBe('当前负责人');
  });
  it('preserves co-owners and does not invent an owner for ambiguous or unconfirmed mappings',()=>{
    expect(displaySaihuOwner('采购员/其他同事',[mapping('saihu','张三')])).toBe('张三/其他同事');
    expect(displaySaihuOwner('采购员',[mapping('saihu','张三'),mapping('saihu','李四')])).toBe('采购员');
    expect(displaySaihuOwner('采购员',[mapping('saihu','张三',0)])).toBe('采购员');
    expect(displaySaihuOwner(null,[])).toBeNull();
  });
  it('rejects retired connection and has no router, scheduler or remote client entry',()=>{
    expect(ApiConnectionCodeSchema.safeParse('lingxing').success).toBe(false);
    expect(readFileSync('server/routers.ts','utf8')).not.toContain('lingxingSyncRouter');
    expect(readFileSync('server/_core/scheduler.ts','utf8')).not.toContain('startLocalLingxing');
    expect(readFileSync('server/_core/index.ts','utf8')).not.toContain('/api/scheduled/lingxing-sync-draft');
    expect(existsSync('server/domains/ai_os/services/toolGateway/lingxingReadContract.ts')).toBe(false);
    expect(existsSync('client/src/pages/ops/OpsLingxingSync.tsx')).toBe(false);
  });
});
