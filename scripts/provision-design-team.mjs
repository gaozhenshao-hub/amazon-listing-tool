// Explicit one-time operator tool. Input contains hashes, never plaintext passwords.
import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
export async function provisionDesignTeam(db, accounts, workspaceId, actorId) {
  if (!Array.isArray(accounts) || accounts.length !== 3 || new Set(accounts.map(a=>a.username)).size !== 3) throw Error("Expected three distinct designer accounts");
  for (const a of accounts) if (!/^[a-z][a-z0-9_.-]{2,31}$/.test(a.username) || typeof a.name!=="string" || !a.name.trim() || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(a.passwordHash)) throw Error("Invalid account input");
  const [lock] = await db.query("SELECT GET_LOCK('provision_design_team',30) AS ok");
  if (Number(lock[0].ok)!==1) throw Error("Account setup is busy");
  try {
    await db.beginTransaction();
    const [actor]=await db.execute("SELECT id FROM users WHERE id=? AND status='active' AND role IN ('admin','super_admin')",[actorId]);
    const [workspaces]=await db.execute("SELECT id,organizationId FROM workspaces WHERE id=? AND status='active'",[workspaceId]);
    if(actor.length!==1 || workspaces.length!==1) throw Error("Administrator or workspace not available");
    const [permissions]=await db.query("SELECT * FROM role_permissions WHERE role='designer' FOR UPDATE");
    const [designers]=await db.query("SELECT id FROM users WHERE role='designer'");
    const operations=['read','edit','delete'];
    const details=[{moduleId:'design',operations,subModules:['design_images','design_prompts'].map(subModuleId=>({subModuleId,operations}))}];
    if(permissions.length) {
      if(JSON.stringify(JSON.parse(permissions[0].modules))!==JSON.stringify(['design']) || JSON.stringify(JSON.parse(permissions[0].detailedPermissions||'[]'))!==JSON.stringify(details)) throw Error("Existing designer permission configuration requires reconciliation");
    } else {
      if(designers.length) throw Error("Existing designers require permission reconciliation");
      await db.execute("INSERT INTO role_permissions(workspaceId,role,modules,detailedPermissions,description,updatedBy) VALUES(?,'designer',?,?,?,?)",[workspaceId,JSON.stringify(['design']),JSON.stringify(details),'美工生图与团队提示词库',actorId]);
    }
    const results=[];
    for(const a of accounts) {
      const [aliases]=await db.execute("SELECT a.userId,u.name,u.role,u.defaultWorkspaceId FROM user_login_aliases a JOIN users u ON u.id=a.userId WHERE a.username=? FOR UPDATE",[a.username]);
      if(aliases.length) {
        const old=aliases[0];
        if(old.name!==a.name || old.role!=='designer' || old.defaultWorkspaceId!==workspaceId) throw Error("Account alias already belongs to a different user");
        results.push({name:a.name,username:a.username,id:old.userId,status:'existing_no_password_reset'});continue;
      }
      const [collisions]=await db.execute("SELECT id FROM users WHERE name=? OR email=? OR phone=? LIMIT 1",[a.name,a.username,a.username]);
      if(collisions.length) throw Error("Existing identity requires reconciliation");
      const [created]=await db.execute("INSERT INTO users(openId,organizationId,defaultWorkspaceId,name,password,loginMethod,role,department,jobTitle,status,mustChangePassword,invitedBy) VALUES(?,?,?,?,?,'password','designer','美工','美工','active',1,?)",['local:designer:'+a.username,workspaces[0].organizationId,workspaceId,a.name,a.passwordHash,actorId]);
      const id=created.insertId;
      await db.execute("INSERT INTO user_login_aliases(username,userId) VALUES(?,?)",[a.username,id]);
      await db.execute("INSERT INTO workspace_memberships(workspaceId,userId,role,status,invitedBy,joinedAt) VALUES(?,?,'designer','active',?,NOW())",[workspaceId,id,actorId]);
      await db.execute("INSERT INTO security_audit_logs(auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,resourceName,status,riskLevel,reason,metadata) VALUES(?,?,?,'super_admin','design_team.account_created','user',?,?,'success','medium',?,?)",[randomUUID(),workspaceId,actorId,String(id),a.name,'管理员明确要求创建三位美工账号，仅开放美工板块',JSON.stringify({username:a.username,role:'designer',modules:['design'],mustChangePassword:true})]);
      results.push({name:a.name,username:a.username,id,status:'created'});
    }
    await db.commit();return results;
  } catch(error) {await db.rollback();throw error;}
  finally {await db.query("SELECT RELEASE_LOCK('provision_design_team')");}
}
if (process.argv.includes('--execute')) {
  const input=process.argv.find(s=>s.startsWith('--input='))?.slice(8);
  const target=process.argv.find(s=>s.startsWith('--database='))?.slice(11);
  if(!input || !target || !process.env.DATABASE_URL) throw Error('Explicit input and target database required');
  const payload=JSON.parse(await readFile(input,'utf8'));
  const db=await mysql.createConnection(process.env.DATABASE_URL);
  try {const [name]=await db.query('SELECT DATABASE() AS name');if(name[0].name!==target)throw Error('Wrong database');console.log(JSON.stringify(await provisionDesignTeam(db,payload.accounts,payload.workspaceId,payload.actorId)));}
  finally {await db.end();}
}
