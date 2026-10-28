-- Preserve long meeting transcripts without truncation; existing contents are unchanged.
ALTER TABLE meeting_records MODIFY COLUMN transcript MEDIUMTEXT NULL;
