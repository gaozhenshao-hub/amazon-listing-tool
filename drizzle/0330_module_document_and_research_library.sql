-- DEDICATED RELEASE ONLY. Additive module workflow and private collection release. Existing project facts, image entries and library assets are unchanged.
CREATE TABLE IF NOT EXISTS research_bookmarks (
 id CHAR(36) NOT NULL PRIMARY KEY,workspace_id INT NOT NULL,user_id INT NOT NULL,
 kind VARCHAR(16) NOT NULL,identity_hash CHAR(64) NOT NULL,site VARCHAR(100) NOT NULL,asin VARCHAR(10) NULL,
 title VARCHAR(1000) NOT NULL,url VARCHAR(2000) NOT NULL,thumbnail VARCHAR(2000) NOT NULL DEFAULT '',price VARCHAR(100) NOT NULL DEFAULT '',brand VARCHAR(200) NOT NULL DEFAULT '',
 revision INT NOT NULL DEFAULT 1,note TEXT NULL,state VARCHAR(24) NOT NULL DEFAULT 'pending',deleted_at TIMESTAMP NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY research_bookmark_owner(workspace_id,user_id,kind,identity_hash),KEY research_bookmark_list(workspace_id,kind,user_id,created_at)
);
CREATE TABLE IF NOT EXISTS research_extension_sessions (
 id CHAR(36) NOT NULL PRIMARY KEY,token_hash CHAR(64) NOT NULL,code_hash CHAR(64) NULL,
 workspace_id INT NULL,user_id INT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',
 extension_origin VARCHAR(100) NOT NULL DEFAULT '',browser_name VARCHAR(100) NOT NULL DEFAULT '浏览器收藏插件',expires_at DATETIME NOT NULL,last_used_at DATETIME NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY research_extension_token(token_hash),UNIQUE KEY research_extension_code(code_hash),KEY research_extension_owner(workspace_id,user_id,status)
);
CREATE TABLE IF NOT EXISTS listing_image_composition_sketches (
 id CHAR(36) NOT NULL PRIMARY KEY,project_id INT NOT NULL,workspace_id INT NOT NULL,user_id INT NOT NULL,
 image_id CHAR(36) NOT NULL,input_hash CHAR(64) NOT NULL,generation_id CHAR(36) NOT NULL,
 source_revision INT NOT NULL,candidate_id CHAR(36) NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY image_sketch_generation(generation_id),KEY image_sketch_owner(workspace_id,project_id,user_id,image_id,created_at)
);
