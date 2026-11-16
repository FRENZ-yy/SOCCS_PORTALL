-- ============================================================
--  SOCCS Portal -- full schema rebuild
--  Run in phpMyAdmin > SQL tab, then: python seed.py
-- ============================================================
CREATE DATABASE IF NOT EXISTS soccs_portal CHARACTER SET utf8mb4;
USE soccs_portal;

DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS task_logs;
DROP TABLE IF EXISTS committee_assignments;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS committees;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  officer_id    VARCHAR(20)  NULL,
  full_name     VARCHAR(100)  NOT NULL,
  email         VARCHAR(120)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  role          ENUM('Executive','Regular Officer') NOT NULL DEFAULT 'Regular Officer',
  status        ENUM('Pending','Approved')          NOT NULL DEFAULT 'Approved',
  UNIQUE KEY uq_users_officer_id (officer_id)
);

CREATE TABLE events (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  event_name     VARCHAR(120) NOT NULL,
  event_date     DATE         NOT NULL,
  event_end_date DATE         NULL,
  is_completed   TINYINT(1)   NOT NULL DEFAULT 0
);

CREATE TABLE committees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  committee_name VARCHAR(80) NOT NULL,
  event_id       INT         NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE committee_assignments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  committee_id INT NOT NULL,
  UNIQUE KEY uq_user_committee (user_id, committee_id),
  FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
  FOREIGN KEY (committee_id) REFERENCES committees(id) ON DELETE CASCADE
);

CREATE TABLE tasks (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  task_name       VARCHAR(200)  NOT NULL,
  status          TINYINT(1)    NOT NULL DEFAULT 0,
  committee_id    INT           NOT NULL,
  checked_by_id   INT           NULL,
  checked_by_name VARCHAR(100)  NULL,
  checked_by_label VARCHAR(80)  NULL,   -- capacity when ticked: committee name or 'Executive'
  checked_at      DATETIME      NULL,
  FOREIGN KEY (committee_id)  REFERENCES committees(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by_id) REFERENCES users(id)      ON DELETE SET NULL
);

CREATE TABLE notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NULL,
  message    VARCHAR(255) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE notification_reads (
  user_id        INT      NOT NULL,
  notification_id INT     NOT NULL,
  read_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

CREATE TABLE task_logs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          NOT NULL,
  actor_name      VARCHAR(100) NOT NULL,
  actor_label     VARCHAR(80)  NOT NULL DEFAULT '',   -- e.g. 'Logistics' / 'Executive'
  task_id         INT          NOT NULL,
  task_name       VARCHAR(200) NOT NULL,
  committee_name  VARCHAR(80)  NOT NULL DEFAULT '',
  action          ENUM('completed','uncompleted') NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_task_logs_task_created (task_id, created_at)
);

CREATE TABLE members (
  member_id       VARCHAR(20) PRIMARY KEY,
  full_name       VARCHAR(120) NOT NULL,
  student_number  VARCHAR(30)  NOT NULL DEFAULT '',
  course          VARCHAR(20)  NOT NULL DEFAULT '',
  year_level      TINYINT      NOT NULL DEFAULT 1,
  email           VARCHAR(120) NOT NULL DEFAULT '',
  status          VARCHAR(20)  NOT NULL DEFAULT 'Active',
  member_type     VARCHAR(20)  NOT NULL DEFAULT 'Regular',
  position        VARCHAR(60)  NOT NULL DEFAULT '',
  membership_plan VARCHAR(20)  NOT NULL DEFAULT '',
  section         VARCHAR(30)  NULL,
  fee_status      VARCHAR(10)  NOT NULL DEFAULT 'Pending'
);

CREATE TABLE payments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  payment_id  VARCHAR(20) NULL UNIQUE,
  member_id   VARCHAR(20) NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  paid_on     DATE NOT NULL,
  method      VARCHAR(20) NOT NULL,
  reference   VARCHAR(40) NULL,
  received_by VARCHAR(80) NOT NULL DEFAULT '',
  note        VARCHAR(200) NOT NULL DEFAULT '',
  status      ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  recorded_by VARCHAR(100) NOT NULL DEFAULT '',
  approved_by VARCHAR(100) NOT NULL DEFAULT '',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payments_reference (reference),
  FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
);

-- Sample events
INSERT INTO events (event_name, event_date, event_end_date) VALUES
  ('November Fest',    '2026-11-23', '2026-11-25'),
  ('General Assembly', '2026-11-10', NULL);

-- Sample committees
INSERT INTO committees (committee_name, event_id) VALUES
  ('Logistics',     1), ('Creatives',     1),
  ('Finance',       1), ('Documentation', 1),
  ('Logistics',     2), ('Presentations', 2);

-- Sample tasks
INSERT INTO tasks (task_name, status, committee_id) VALUES
  ('Reserve the venue',        1, 1), ('Confirm sound system',   1, 1),
  ('Print floor plan',         0, 1), ('Coordinate booth setup', 0, 1),
  ('Design event poster',      1, 2), ('Prepare stage backdrop', 0, 2),
  ('Collect booth fees',       1, 3), ('Liquidate expenses',     0, 3),
  ('Prepare attendance sheets',1, 4), ('Draft event report',     0, 4),
  ('Book assembly room',       1, 5), ('Set up projector',       0, 5),
  ('Make assembly slides',     1, 6);

-- Seed notifications
INSERT INTO notifications (user_id, message) VALUES
  (NULL, 'November Fest event created.'),
  (NULL, 'General Assembly event created.');

-- Sample members + payments (Payments window)
INSERT INTO members (member_id, full_name, student_number, course, year_level, email, status, member_type, position, membership_plan, section, fee_status) VALUES
  ('SOC-001','Sample Officer','2021-0001','BSCS',4,'officer@example.com','Active','Officer','President','',NULL,'Pending'),
  ('SOC-002','Sample Member','2023-0142','BSIT',2,'member@example.com','Active','Regular','','Standard',NULL,'Pending'),
  ('SOC-003','Francine Mae H. Alcaide','0124-1103','BSCS',2,'fmalcaide49@gmail.com','Active','Regular','','Standard',NULL,'Pending'),
  ('SOC-004','Mika','0988-4456','BSCS',2,'hermida@gmail.com','Active','Officer','Vice President','',NULL,'Pending'),
  ('SOC-005','Alcaide Francine Mae','0001','BSCS',2,'0001@students.soccs','Active','Regular','','Standard','BSCS 2B','Pending'),
  ('SOC-006','Gabrielle Prudente','0002','BSCS',2,'0002@students.soccs','Active','Regular','','Standard','BSCS 2B','Pending'),
  ('SOC-007','Quinto Angelina','0003','BSCS',2,'0003@students.soccs','Active','Regular','','Standard','BSCS 2B','Pending');

INSERT INTO payments (payment_id, member_id, amount, paid_on, method, reference, received_by, note, status, recorded_by, approved_by) VALUES
  ('PAY-1','SOC-002',200,'2026-10-20','Cash','OR-1001','Sample Officer','Partial annual dues','Approved','Admin','Admin'),
  ('PAY-2','SOC-001',200,'2026-11-02','GCash','GC-55821','Admin','Officer dues','Approved','Admin','Admin');
