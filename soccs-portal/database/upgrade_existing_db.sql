-- ============================================================
--  OPTIONAL: manual upgrade for an EXISTING soccs_portal database
--  (phpMyAdmin > soccs_portal > SQL tab > paste > Go).
--
--  You do NOT have to run this: backend/app.py performs the same
--  upgrade automatically every time it starts. It is here so you can
--  see exactly what changes. Requires MariaDB 10.x (IF NOT EXISTS).
--  Keeps all your current events, committees, tasks and users.
-- ============================================================
USE soccs_portal;

-- Numeric payment references are generated from each payment's unique ID.
ALTER TABLE payments MODIFY COLUMN reference VARCHAR(40) NULL;
UPDATE payments SET reference=CONCAT('REF-',id);
UPDATE payments SET reference=LPAD(CAST(id AS CHAR),8,'0');
ALTER TABLE payments ADD UNIQUE KEY uq_payments_reference (reference);

-- Stable officer/member identity, independent of names.
ALTER TABLE users ADD COLUMN IF NOT EXISTS officer_id VARCHAR(20) NULL;
UPDATE users SET officer_id=CONCAT('OFF-',LPAD(id,6,'0')) WHERE officer_id IS NULL OR officer_id='';
ALTER TABLE users ADD UNIQUE KEY uq_users_officer_id (officer_id);

-- 1. Multi-day events (the calendar needs this column to ring event dates)
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end_date DATE NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_completed TINYINT(1) NOT NULL DEFAULT 0;

-- 2. Private notifications ("You have been assigned...") -> only the target user sees them
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INT NULL;
ALTER TABLE notifications
  ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Per-user notification read state
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id        INT      NOT NULL,
  notification_id INT     NOT NULL,
  read_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

-- 3. Who / when / in what capacity a task was ticked
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checked_by_id    INT          NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checked_by_name  VARCHAR(100) NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checked_by_label VARCHAR(80)  NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checked_at       DATETIME     NULL;

-- 4. Full activity history (every check AND uncheck)
CREATE TABLE IF NOT EXISTS task_logs (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT          NOT NULL,
  actor_name     VARCHAR(100) NOT NULL,
  actor_label    VARCHAR(80)  NOT NULL DEFAULT '',
  task_id        INT          NOT NULL,
  task_name      VARCHAR(200) NOT NULL,
  committee_name VARCHAR(80)  NOT NULL DEFAULT '',
  action         ENUM('completed','uncompleted') NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_task_logs_task_created (task_id, created_at)
);
ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS actor_label VARCHAR(80) NOT NULL DEFAULT '';

-- 5. A person can't be put in the same committee twice, and deleting a user cleans up their assignments
DELETE a FROM committee_assignments a JOIN committee_assignments b
  ON a.user_id=b.user_id AND a.committee_id=b.committee_id AND a.id>b.id;
ALTER TABLE committee_assignments ADD UNIQUE KEY uq_user_committee (user_id, committee_id);
ALTER TABLE committee_assignments
  ADD CONSTRAINT committee_assignments_ibfk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
