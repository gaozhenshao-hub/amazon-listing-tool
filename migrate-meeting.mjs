import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Create meeting_records table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS meeting_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(300),
      audio_url TEXT,
      transcript TEXT,
      extracted_tasks TEXT,
      meeting_status ENUM('uploading','transcribing','extracting','done','error') DEFAULT 'uploading' NOT NULL,
      error_message TEXT,
      duration INT,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
    )
  `);
  console.log('meeting_records table created');
  
  // Add meeting_record_id to team_tasks if not exists
  const [cols] = await conn.query('DESCRIBE team_tasks');
  const hasCol = cols.some(c => c.Field === 'meeting_record_id');
  if (hasCol) {
    console.log('meeting_record_id already exists in team_tasks');
  } else {
    await conn.query('ALTER TABLE team_tasks ADD COLUMN meeting_record_id INT DEFAULT NULL');
    console.log('Added meeting_record_id to team_tasks');
  }
  
  await conn.end();
  console.log('Migration complete');
}

main().catch(e => { console.error(e); process.exit(1); });
