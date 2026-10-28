ALTER TABLE knowledge_adjustments MODIFY COLUMN kind enum('set','image','video') NOT NULL;
ALTER TABLE knowledge_tag_improvements MODIFY COLUMN kind enum('set','image','video') NOT NULL;

ALTER TABLE acquisition_jobs ADD COLUMN accepted_missing int NOT NULL DEFAULT 0;
