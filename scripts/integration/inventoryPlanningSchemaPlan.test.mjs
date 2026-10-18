import test from 'node:test';
import assert from 'node:assert/strict';
import { INVENTORY_PLANNING_INDEX_CANDIDATE as candidate, INVENTORY_PLANNING_INDEX_REQUIREMENTS, planInventoryPlanningSchema } from './inventoryPlanningSchemaPlan.mjs';

const col=(name,type,nullable=false)=>({name,type,nullable,extra:name==='id'?'auto_increment':'',defaultValue:null,...(/varchar|enum/.test(type)?{collation:'utf8mb4_general_ci'}:{})});
const idx=(name,columns,unique=false)=>({name,columns,unique,prefixLengths:columns.map(()=>null)});
function fixture(){
  const common=[col('id','int'),col('workspaceId','int',true),col('user_id','int'),col('created_at','timestamp'),col('updated_at','timestamp')];
  const locals=[...common,col('asin','varchar(20)'),col('store_name','varchar(200)'),col('country','varchar(50)'),col('effective_date','varchar(10)'),col('local_qty','int'),col('reason','varchar(500)',true),col('status',"enum('draft','confirmed','superseded')"),col('confirmed_by','int',true),col('confirmed_at','timestamp',true),col('superseded_by_id','int',true)];
  const params=[...common,col('scope_type',"enum('workspace','store_country','parent_asin','asin')"),col('asin','varchar(20)',true),col('parent_asin','varchar(20)',true),col('store_name','varchar(200)',true),col('country','varchar(50)',true),...['production_days','shipping_days','buffer_days','target_cover_days','moq','pack_size'].map(n=>col(n,'int')),col('is_active','tinyint(4)'),...['product_cost','estimated_first_leg_cost','actual_first_leg_cost','estimated_fba_fee','actual_fba_fee','selling_price'].map(n=>col(n,'decimal(10,2)',true)),...['estimated_dimensions','actual_dimensions'].map(n=>col(n,'varchar(120)',true)),...['estimated_weight','actual_weight'].map(n=>col(n,'decimal(10,3)',true)),col('dimension_unit','varchar(12)'),col('weight_unit','varchar(12)'),col('currency','varchar(8)')];
  return {complete:true,databaseVerified:true,candidate,tables:[
    {name:'ops_local_inventory_adjustments',complete:true,exists:true,engine:'InnoDB',collation:'utf8mb4_general_ci',columns:locals,indexes:[idx('PRIMARY',['id'],true),idx('idx_ops_local_inventory_current',['workspaceId','asin','store_name','country','status','effective_date'])]},
    {name:'ops_inventory_planning_parameters',complete:true,exists:true,engine:'InnoDB',collation:'utf8mb4_general_ci',columns:params,indexes:[idx('PRIMARY',['id'],true),idx('idx_ops_inventory_parameter_scope',['workspaceId','scope_type','asin','store_name','country','is_active']),idx('idx_ops_inventory_parameters_parent_scope',['workspaceId','user_id','scope_type','parent_asin','store_name','country','is_active'])]},
  ]};
}
test('extends only the two missing actor indexes, preserving existing0143 parent index and all old data',()=>{
  const input=fixture(), before=JSON.stringify(input),result=planInventoryPlanningSchema(input);
  assert.equal(JSON.stringify(input),before);
  assert.equal(result.state,'index_extension_required');assert.equal(result.statements.length,2);
  for(const sql of result.statements){assert.match(sql,/^ALTER TABLE .* ADD INDEX /);assert.doesNotMatch(sql,/UNIQUE|DROP|UPDATE |DELETE|TRUNCATE|CREATE TABLE|INSERT/);}
  assert.equal(result.migrationNumber,null);assert.equal(result.executable,false);assert.equal(result.productionApproved,false);
  assert.equal(result.sourceTablesModified,false);assert.equal(result.businessRowsModified,false);assert.equal(result.ledgerRegistration,'unchanged');
});
test('accepts ready full-column actor indexes with trailing id without redundant extensions',()=>{
  const input=fixture();for(const r of INVENTORY_PLANNING_INDEX_REQUIREMENTS)input.tables.find(t=>t.name===r.table).indexes.push(idx(r.name,[...r.columns,'id']));
  const result=planInventoryPlanningSchema(input);assert.equal(result.state,'actor_indexes_ready');assert.deepEqual(result.statements,[]);
});
test('missing existing parent actor index adds only that index in addition to two others',()=>{
  const input=fixture();input.tables[1].indexes.pop();assert.equal(planInventoryPlanningSchema(input).statements.length,3);
});
test('preserves legacy null workspace rows and accepts separately reviewed non-null workspace schema',()=>{
  const input=fixture();input.tables.forEach(t=>t.columns.find(c=>c.name==='workspaceId').nullable=false);
  assert.equal(planInventoryPlanningSchema(input).statements.length,2);
});
for(const collation of ['utf8mb4_general_ci','utf8mb4_unicode_ci','utf8mb4_0900_ai_ci','utf8mb4_bin','utf8mb4_0900_bin'])test('keeps existing permitted collation '+collation,()=>{
  const input=fixture();input.tables.forEach(t=>{t.collation=collation;t.columns.filter(c=>c.collation).forEach(c=>c.collation=collation);});assert.equal(planInventoryPlanningSchema(input).statements.length,2);
});
const invalidCases=[
  ['incomplete',s=>s.complete=false,/INCOMPLETE/],
  ['unverified database',s=>s.databaseVerified=false,/INCOMPLETE/],
  ['cannot consume0314',s=>s.candidate='0314_integration_inventory_snapshot.sql',/INCOMPLETE/],
  ['missing table',s=>s.tables[0].exists=false,/EXISTING_BASELINE_REQUIRED/],
  ['partial table',s=>s.tables[0].complete=false,/EXISTING_BASELINE_REQUIRED/],
  ['unknown table',s=>s.tables[0].name='other',/EXISTING_BASELINE_REQUIRED/],
  ['duplicate table',s=>s.tables[1]=structuredClone(s.tables[0]),/TABLE_SET_INVALID/],
  ['nontransactional engine',s=>s.tables[0].engine='MyISAM',/STORAGE_INCOMPATIBLE/],
  ['unknown charset',s=>s.tables[0].collation='latin1_swedish_ci',/STORAGE_INCOMPATIBLE/],
  ['unknown text collation',s=>s.tables[0].columns.find(c=>c.name==='asin').collation='utf8mb3_general_ci',/COLLATION_INCOMPATIBLE/],
  ['missing costs',s=>s.tables[1].columns=s.tables[1].columns.filter(c=>c.name!=='product_cost'),/COLUMN_INCOMPATIBLE/],
  ['wrong decimal precision',s=>s.tables[1].columns.find(c=>c.name==='product_cost').type='decimal(14,4)',/COLUMN_INCOMPATIBLE/],
  ['unsigned range change',s=>s.tables[0].columns.find(c=>c.name==='local_qty').type='int unsigned',/COLUMN_INCOMPATIBLE/],
  ['nullable quantity',s=>s.tables[0].columns.find(c=>c.name==='local_qty').nullable=true,/NULLABILITY_INCOMPATIBLE/],
  ['derived cost column',s=>s.tables[1].columns.find(c=>c.name==='product_cost').extra='STORED GENERATED',/GENERATED_BUSINESS_COLUMN/],
  ['duplicate column',s=>s.tables[0].columns.push(structuredClone(s.tables[0].columns[0])),/COLUMN_INVALID/],
  ['missing declared default',s=>delete s.tables[0].columns[0].defaultValue,/COLUMN_INVALID/],
  ['required unknown extension',s=>s.tables[0].columns.push(col('business_required','int')),/REQUIRED_EXTENSION/],
  ['missing primary',s=>s.tables[0].indexes.shift(),/PRIMARY_INCOMPATIBLE/],
  ['duplicate index name',s=>s.tables[0].indexes.push(structuredClone(s.tables[0].indexes[0])),/INDEX_INVALID/],
  ['expression index not inspected',s=>s.tables[0].indexes[1].columns[0]=null,/INDEX_INVALID/],
  ['index duplicate column',s=>s.tables[0].indexes.push(idx('bad',['asin','asin'])),/INDEX_INVALID/],
  ['prefix primary',s=>s.tables[0].indexes[0].prefixLengths[0]=1,/PRIMARY_INCOMPATIBLE/],
  ['nullable scope unique not canonical',s=>s.tables[1].indexes.push(idx('unsafe_scope',['workspaceId','user_id','asin','parent_asin'],true)),/UNREVIEWED_UNIQUENESS/],
  ['name collision',s=>s.tables[0].indexes.push(idx('idx_inventory_local_actor_scope',['workspaceId'])),/INDEX_NAME_CONFLICT/],
];
for(const [label,change,error]of invalidCases)test('refuses '+label,()=>{const s=fixture();change(s);assert.throws(()=>planInventoryPlanningSchema(s),error);});
test('does not count prefix-length truncation as exact actor identity support',()=>{
  const s=fixture(),r=INVENTORY_PLANNING_INDEX_REQUIREMENTS[0],bad=idx('other_truncated',r.columns);bad.prefixLengths[3]=12;s.tables[0].indexes.push(bad);
  assert.equal(planInventoryPlanningSchema(s).statements.length,2);
});
test('optional unknown nullable extension remains untouched',()=>{
  const s=fixture();s.tables[0].columns.push(col('old_note','varchar(50)',true));assert.equal(planInventoryPlanningSchema(s).statements.length,2);
});
