import { sql } from "drizzle-orm";
import { requireDb,closeDbConnection } from "../server/repositories/dbClient";
import { planningRows,planningJson } from "../server/domains/listing/imagePlanningStore";
import { imageDocumentConfiguration } from "../server/domains/listing/imageDocumentContext";
import { readImageDocument } from "../server/domains/listing/imageDocumentStore";
import { readWorkspaceSaihu } from "../server/domains/apiConnections/workspaceSaihu";
import { IMAGE_DOCUMENT_SKILL,IMAGE_DOCUMENT_PROMPT } from "../server/domains/listing/imageDocumentPrompt";
import { configureImageDocument } from "./setup-image-document";
try{
 const db=await requireDb("verify image document release"),[project]=await planningRows(db,sql`SELECT userId,workspaceId FROM projects WHERE id=1`);
 if(!project)throw new Error("Current project unavailable");const scope={projectId:1,workspaceId:Number(project.workspaceId),userId:Number(project.userId)};
 if(process.argv.includes("--configure"))console.log(JSON.stringify({configuration:await configureImageDocument(scope.workspaceId,scope.userId)}));
 const [skill]=await planningRows(db,sql`SELECT name,status,version,manifest FROM emperor_skills WHERE slug=${IMAGE_DOCUMENT_SKILL} AND workspaceId IS NULL`);
 if(!skill || skill.name!=="套图文档策划" || skill.status!=="Released" || planningJson(skill.manifest)?.implementation?.systemPrompt!==IMAGE_DOCUMENT_PROMPT)throw new Error("Image document Skill differs from this release");
 const config=await imageDocumentConfiguration(scope),document=await readImageDocument(scope),settings=await readWorkspaceSaihu(scope),[candidateTable]=await planningRows(db,sql`SELECT COUNT(*) AS n FROM listing_image_document_candidates WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`),[checkTable]=await planningRows(db,sql`SELECT COUNT(*) AS n FROM system_api_connection_checks WHERE workspace_id=${scope.workspaceId}`);
 if(!config)throw new Error("Image document binding unavailable");
 console.log(JSON.stringify({status:"IMAGE_DOCUMENT_RELEASE_VERIFIED",skillName:skill.name,skillVersion:Number(skill.version),configurationRevision:config.revision,documentImages:document.data.entries.length,documentRevision:document.revision,candidates:Number(candidateTable.n),workspaceApiConfigured:settings.configured,workspaceApiHasSecret:settings.hasSecret,connectionChecks:Number(checkTable.n)}));
}finally{await closeDbConnection();}
