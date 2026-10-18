import { describe, it, expect } from "vitest";
import { createVideoWorkflowTestFixture } from "./videoWorkflow.testFixture";
import { captureVideoWorkflowTables } from "./videoWorkflowSource";
import { restoreVideoWorkflowVersion, saveVideoWorkflowVersion } from "./videoWorkflowPublication";

describe("complete video business history restore (synthetic SQL protocol, not native DB)", () => {
  it("restores all original parent/child IDs and rows, including product/competitor/SPV, without a provider", async () => {
    const f=createVideoWorkflowTestFixture(); const original=await captureVideoWorkflowTables(f.tx,f.scope);
    await f.database.transaction(tx=>saveVideoWorkflowVersion(tx,original,3,"Synthetic before"));
    f.state.sourceTables.video_product_snapshots[0].basicInfo={changed:true};
    f.state.sourceTables.video_competitor_scripts[0].rawContent="CHANGED";
    f.state.sourceTables.video_script_shots=[];
    const result=await f.database.transaction(tx=>restoreVideoWorkflowVersion(tx,f.scope,f.state.sourceTables.video_script_versions[0].snapshotData));
    expect(result.restoration).toBe("full");
    const restored=await captureVideoWorkflowTables(f.tx,f.scope);
    const business=(rows:Record<string,unknown>[])=>rows.map(({createdAt:_c,updatedAt:_u,...row})=>row);
    for(const name of Object.keys(original)) expect(business(restored[name])).toEqual(business(original[name]));
    expect(f.providerContexts).toEqual([]);expect(f.state.sourceTables.video_script_versions).toHaveLength(1);
  });
  it("old partial snapshot restores shots and children while retaining uncaptured 0A/0B/SPV",async()=>{
    const f=createVideoWorkflowTestFixture(), original=await captureVideoWorkflowTables(f.tx,f.scope);
    const legacy={script:original.video_scripts[0],sections:original.video_script_sections,subtopics:original.video_script_subtopics,shots:original.video_script_shots,editScripts:original.video_edit_scripts};
    f.state.sourceTables.video_product_snapshots[0].basicInfo={currentUncaptured:true}; f.state.sourceTables.video_script_shots=[];
    const result=await f.database.transaction(tx=>restoreVideoWorkflowVersion(tx,f.scope,JSON.stringify(legacy)));
    expect(result.restoration).toBe("legacy_partial_preserving_uncaptured");expect(f.state.sourceTables.video_script_shots[0].id).toBe(25);
    expect(f.state.sourceTables.video_product_snapshots[0].basicInfo).toEqual({currentUncaptured:true});
  });
  it.each(["scope","hierarchy","incomplete","duplicate"])("refuses malformed %s version before deletion",async kind=>{
    const f=createVideoWorkflowTestFixture(), tables=await captureVideoWorkflowTables(f.tx,f.scope);
    if(kind==="scope")tables.video_scripts[0].projectId=999;
    if(kind==="hierarchy")tables.video_script_shots[0].subtopicId=999;
    if(kind==="incomplete")delete tables.video_product_snapshots;
    if(kind==="duplicate")tables.video_script_shots.push({...tables.video_script_shots[0]});
    await expect(f.database.transaction(tx=>restoreVideoWorkflowVersion(tx,f.scope,{schema:"video-workflow-full-version/v1",tables}))).rejects.toThrow();
    expect(f.calls.some(call=>call.sql.startsWith("DELETE"))).toBe(false);
  });
  it("warning or mid-restore write error rolls back every delete/insert and preserves the historical row",async()=>{
    const f=createVideoWorkflowTestFixture(), tables=await captureVideoWorkflowTables(f.tx,f.scope), before=structuredClone(f.state);
    f.control.failWrite="INSERT INTO `video_product_snapshots`";
    await expect(f.database.transaction(tx=>restoreVideoWorkflowVersion(tx,f.scope,{schema:"video-workflow-full-version/v1",tables}))).rejects.toThrow();
    expect(f.state).toEqual(before);
  });
});
