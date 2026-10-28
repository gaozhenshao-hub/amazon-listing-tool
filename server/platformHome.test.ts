import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
describe("slim platform navigation",()=>{
 const home=readFileSync("client/src/pages/PlatformHome.tsx","utf8");
 const layout=readFileSync("client/src/components/DashboardLayout.tsx","utf8");
 const app=readFileSync("client/src/App.tsx","utf8");
 it("exposes the eight work modules plus home and preserves access filtering",()=>{
   for(const id of ["dev","procurement","ops","design","finance","knowledge","emperor","admin"]) expect(home).toContain('id: "'+id+'"');
   expect(home).toContain("permissions.hasModuleAccess"); expect(layout).toContain('"home"');
 });
 it("keeps Listing inside operations and retired top-level surfaces absent",()=>{
   expect(layout).toContain('id: "listing-generation"');expect(layout).not.toContain('id: "listing",');
   for(const old of ["/offsite/","/service/","/knowledge/videos","/emperor/observability"]) expect(app).not.toContain('path="'+old);
 });
 it("keeps placeholders and the three operations boards accessible",()=>{
   expect(app).toContain("ComingSoon");
   for(const route of ["/ops/product-tasks","/ops/profit-board","/ops/product-board"]) expect(app).toContain('path="'+route+'"');
 });
});
