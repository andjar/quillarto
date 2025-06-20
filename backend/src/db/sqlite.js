const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use a file-based database in the db folder; it will be created if it doesn't exist.
const DB_SOURCE = path.join(__dirname, 'quartorium.db');

const db = new sqlite3.Database(DB_SOURCE, (err) => {
  if (err) {
    console.error(err.message);
    throw err;
  }
  console.log('✅ Connected to the SQLite database.');
});

// Create the users table if it doesn't exist
const createUsersTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      avatar_url TEXT,
      github_token TEXT, -- ADD THIS LINE
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error creating users table:', err.message);
    } else {
      console.log('✅ Users table is ready.');
    }
  });
};

const createReposTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      github_repo_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      is_private BOOLEAN NOT NULL,
      main_branch TEXT DEFAULT 'main',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error creating repositories table:', err.message);
    } else {
      console.log('✅ Repositories table is ready.');
    }
  });
};

const createDocumentsTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      filepath TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repo_id, filepath),
      FOREIGN KEY (repo_id) REFERENCES repositories (id)
    )
  `;
  db.run(sql, (err) => {
    if (err) console.error('Error creating documents table:', err.message);
    else console.log('✅ Documents table is ready.');
  });
};

const createShareLinksTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      share_token TEXT UNIQUE NOT NULL,
      collab_branch_name TEXT NOT NULL,
      collaborator_label TEXT,
      user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doc_id) REFERENCES documents (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `;
  db.run(sql, (err) => {
    if (err) console.error('Error creating share_links table:', err.message);
    else console.log('✅ Share Links table is ready.');
  });
};

// Initialize the database and table
createUsersTable();
createReposTable();
createDocumentsTable();
createShareLinksTable();

// Create the live_documents table
const createLiveDocumentsTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS live_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER,
      filepath TEXT,
      share_token TEXT UNIQUE,
      prosemirror_json TEXT NOT NULL,
      base_commit_hash TEXT NOT NULL,
      comments_json TEXT DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE,
      CHECK (
        (repo_id IS NOT NULL AND filepath IS NOT NULL AND share_token IS NULL) OR
        (repo_id IS NULL AND filepath IS NULL AND share_token IS NOT NULL)
      )
    )
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error creating live_documents table:', err.message);
    } else {
      console.log('✅ live_documents table is ready.');
      // Add a trigger to update updated_at on row modification
      const triggerSql = `
        CREATE TRIGGER IF NOT EXISTS update_live_documents_updated_at
        AFTER UPDATE ON live_documents
        FOR EACH ROW
        BEGIN
          UPDATE live_documents SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END;
      `;
      db.run(triggerSql, (triggerErr) => {
        if (triggerErr) {
          console.error('Error creating trigger for live_documents:', triggerErr.message);
        } else {
          console.log('✅ Trigger for live_documents is ready.');
        }
      });
      
      // Add comments_json column to existing table if it doesn't exist
      db.all("PRAGMA table_info(live_documents)", (err, rows) => {
        if (err) {
          console.error('Error checking table schema:', err.message);
          return;
        }
        
        const hasCommentsJson = rows.some(row => row.name === 'comments_json');
        if (!hasCommentsJson) {
          db.run("ALTER TABLE live_documents ADD COLUMN comments_json TEXT DEFAULT '[]'", (alterErr) => {
            if (alterErr) {
              console.error('Error adding comments_json column:', alterErr.message);
            } else {
              console.log('✅ Added comments_json column to live_documents table.');
            }
          });
        }
      });
    }
  });
};

createLiveDocumentsTable();

// Create the branch_locks table for collaboration locking
const createBranchLocksTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS branch_locks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      branch_name TEXT NOT NULL,
      locked_by_user_id INTEGER,
      locked_by_collaborator_label TEXT,
      locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (repo_id) REFERENCES repositories (id)
    )
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error creating branch_locks table:', err.message);
    } else {
      console.log('✅ Branch locks table is ready.');
      
      // Create indexes for better performance
      const indexSql = `
        CREATE INDEX IF NOT EXISTS idx_branch_locks_repo_branch 
        ON branch_locks (repo_id, branch_name, is_active)
      `;
      db.run(indexSql, (indexErr) => {
        if (indexErr) {
          console.error('Error creating branch_locks index:', indexErr.message);
        } else {
          console.log('✅ Branch locks index is ready.');
        }
      });
    }
  });
};

createBranchLocksTable();

// Function to clean up expired locks
const cleanupExpiredLocks = () => {
  const sql = `
    UPDATE branch_locks 
    SET is_active = 0 
    WHERE is_active = 1 
    AND expires_at IS NOT NULL 
    AND expires_at < CURRENT_TIMESTAMP
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error cleaning up expired locks:', err.message);
    } else {
      console.log('✅ Cleaned up expired locks');
    }
  });
};

// Clean up expired locks every 5 minutes
setInterval(cleanupExpiredLocks, 5 * 60 * 1000);

// Initial cleanup
cleanupExpiredLocks();

// Migration function to add main_branch column to existing repositories
const migrateReposTable = () => {
  // Check if main_branch column exists
  db.all("PRAGMA table_info(repositories)", (err, rows) => {
    if (err) {
      console.error('Error checking repositories table schema:', err.message);
      return;
    }
    
    const hasMainBranch = rows.some(row => row.name === 'main_branch');
    if (!hasMainBranch) {
      // Add main_branch column with default value
      db.run("ALTER TABLE repositories ADD COLUMN main_branch TEXT DEFAULT 'main'", (alterErr) => {
        if (alterErr) {
          console.error('Error adding main_branch column:', alterErr.message);
        } else {
          console.log('✅ Added main_branch column to repositories table.');
        }
      });
    }
  });
};

migrateReposTable();

module.exports = db;