"""SOCCS Portal backend -- Flask + PyMySQL (XAMPP MySQL)."""
import os, re, sys, secrets
from datetime import date, datetime, timedelta
from functools import wraps
from io import BytesIO

import pymysql
from flask import Flask, jsonify, request, session, send_file, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

DB_HOST     = 'localhost'
DB_PORT     = 3307
DB_USER     = 'root'
DB_PASSWORD = ''
DB_NAME     = 'soccs_portal'

BASE = os.path.dirname(os.path.abspath(__file__))
app  = Flask(__name__, static_folder=os.path.join(BASE, '..', 'public'), static_url_path='')
app.secret_key = os.environ.get('SECRET_KEY', 'change-me-in-production')
app.permanent_session_lifetime = timedelta(days=7)

DB = dict(host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
          database=DB_NAME, charset='utf8mb4',
          cursorclass=pymysql.cursors.DictCursor, autocommit=True)


# -- helpers ------------------------------------------------------------------
def db_problem(e):
    code = e.args[0] if e.args else None
    if code == 1045: return "MySQL refused login for '%s'. Check DB_PASSWORD in app.py." % DB_USER
    if code == 1049: return "Database '%s' not found. Import database/schema.sql first." % DB_NAME
    if code in (2002, 2003): return "Cannot reach MySQL on port %s. Start MySQL in XAMPP." % DB_PORT
    return "Database error: %s" % (e.args[1] if len(e.args) > 1 else e)

def check_db():
    try: pymysql.connect(**DB).close()
    except pymysql.MySQLError as e:
        print("\nCANNOT CONNECT TO DATABASE\n" + db_problem(e) + "\n"); sys.exit(1)

check_db()


# -- Auto-migration -----------------------------------------------------------
# Brings an OLDER database (e.g. one exported before event_end_date / audit
# columns existed) up to the current structure. Safe to run on every start:
# every step first checks whether it is already done.
def _scalar(sql, args=()):
    con = pymysql.connect(**DB)
    try:
        with con.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
            return next(iter(row.values())) if row else None
    finally: con.close()

def _has_column(table, col):
    return bool(_scalar("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() "
                        "AND TABLE_NAME=%s AND COLUMN_NAME=%s", (table, col)))

def _has_index(table, name):
    return bool(_scalar("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() "
                        "AND TABLE_NAME=%s AND INDEX_NAME=%s", (table, name)))

def _has_fk(table, name):
    return bool(_scalar("SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() "
                        "AND TABLE_NAME=%s AND CONSTRAINT_NAME=%s AND CONSTRAINT_TYPE='FOREIGN KEY'", (table, name)))

def _step(label, fn):
    try: fn()
    except Exception as e: print('  [migration skipped] %s: %s' % (label, e))


# -- Payments (ported from the Login & Dashboard project) ---------------------
DEFAULT_DUES    = 250.0
PAY_COURSES     = ['BSCS', 'BSIT']
PAYMENT_METHODS = ['Cash', 'GCash', 'Bank transfer']
LEDGER_STATUSES = ['Pending', 'Partial', 'Paid']
SCHOOL_YEAR     = '2025-2026'
# (member_id, full_name, student_number, course, year, email, status, type, position, plan, section, fee_status)
SAMPLE_MEMBERS = [
    ('SOC-001', 'Sample Officer', '2021-0001', 'BSCS', 4, 'officer@example.com', 'Active', 'Officer', 'President', '', None, 'Pending'),
    ('SOC-002', 'Sample Member', '2023-0142', 'BSIT', 2, 'member@example.com', 'Active', 'Regular', '', 'Standard', None, 'Pending'),
    ('SOC-003', 'Francine Mae H. Alcaide', '0124-1103', 'BSCS', 2, 'fmalcaide49@gmail.com', 'Active', 'Regular', '', 'Standard', None, 'Pending'),
    ('SOC-004', 'Mika', '0988-4456', 'BSCS', 2, 'hermida@gmail.com', 'Active', 'Officer', 'Vice President', '', None, 'Pending'),
    ('SOC-005', 'Alcaide Francine Mae', '0001', 'BSCS', 2, '0001@students.soccs', 'Active', 'Regular', '', 'Standard', 'BSCS 2B', 'Pending'),
    ('SOC-006', 'Gabrielle Prudente', '0002', 'BSCS', 2, '0002@students.soccs', 'Active', 'Regular', '', 'Standard', 'BSCS 2B', 'Pending'),
    ('SOC-007', 'Quinto Angelina', '0003', 'BSCS', 2, '0003@students.soccs', 'Active', 'Regular', '', 'Standard', 'BSCS 2B', 'Pending'),
]
# (payment_id, member_id, amount, date, method, reference, received_by, note)
SAMPLE_PAYMENTS = [
    ('PAY-1', 'SOC-002', 200, '2026-10-20', 'Cash',  'OR-1001',  'Sample Officer', 'Partial annual dues'),
    ('PAY-2', 'SOC-001', 200, '2026-11-02', 'GCash', 'GC-55821', 'Admin',          'Officer dues'),
]

def ensure_schema():
    def add_col(table, col, ddl):
        if not _has_column(table, col):
            execute('ALTER TABLE `%s` ADD COLUMN %s' % (table, ddl)); print('  [migration] %s.%s added' % (table, col))

    # events: multi-day support
    _step('events.event_end_date', lambda: add_col('events', 'event_end_date', '`event_end_date` DATE NULL'))
    _step('events.description',     lambda: add_col('events', 'description',     '`description` VARCHAR(100) NULL'))
    _step('events.is_completed',    lambda: add_col('events', 'is_completed',    '`is_completed` TINYINT(1) NOT NULL DEFAULT 0'))

    # notifications: per-user messages (NULL = visible to executives / org-wide)
    def notif():
        add_col('notifications', 'user_id', '`user_id` INT NULL')
        if not _has_fk('notifications', 'fk_notifications_user'):
            execute('UPDATE notifications SET user_id=NULL WHERE user_id IS NOT NULL '
                    'AND user_id NOT IN (SELECT id FROM users)')
            execute('ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user '
                    'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE')
    _step('notifications.user_id', notif)
    _step('notification_reads', lambda: execute("""CREATE TABLE IF NOT EXISTS notification_reads (
        user_id INT NOT NULL,
        notification_id INT NOT NULL,
        read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, notification_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE)"""))

    # tasks: audit columns (who + when + in what capacity)
    _step('tasks.checked_by_id',    lambda: add_col('tasks', 'checked_by_id',    '`checked_by_id` INT NULL'))
    _step('tasks.checked_by_name',  lambda: add_col('tasks', 'checked_by_name',  '`checked_by_name` VARCHAR(100) NULL'))
    _step('tasks.checked_at',       lambda: add_col('tasks', 'checked_at',       '`checked_at` DATETIME NULL'))
    _step('tasks.checked_by_label', lambda: add_col('tasks', 'checked_by_label', '`checked_by_label` VARCHAR(80) NULL'))

    # task_logs: full history table
    _step('task_logs', lambda: execute("""CREATE TABLE IF NOT EXISTS task_logs (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, actor_name VARCHAR(100) NOT NULL,
        task_id INT NOT NULL, task_name VARCHAR(200) NOT NULL, committee_name VARCHAR(80) NOT NULL DEFAULT '',
        action ENUM('completed','uncompleted') NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        INDEX idx_task_logs_task_created (task_id, created_at))"""))
    _step('task_logs.actor_label', lambda: add_col('task_logs', 'actor_label', '`actor_label` VARCHAR(80) NOT NULL DEFAULT \'\''))

    # users: avatar (base64 data-url)
    _step('users.avatar', lambda: add_col('users', 'avatar', '`avatar` MEDIUMTEXT NULL'))

    # users: stable, unique display ID
    def officer_ids():
        add_col('users', 'officer_id', '`officer_id` VARCHAR(20) NULL')
        execute("UPDATE users SET officer_id=CONCAT('OFF-',LPAD(id,6,'0')) WHERE officer_id IS NULL OR officer_id=''")
        if not _has_index('users', 'uq_users_officer_id'):
            execute('ALTER TABLE users ADD UNIQUE KEY uq_users_officer_id (officer_id)')
    _step('users.officer_id', officer_ids)

    # chat_messages
    _step('chat_messages', lambda: execute("""CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        committee_id INT NOT NULL,
        user_id INT NOT NULL,
        sender_name VARCHAR(100) NOT NULL,
        sender_role ENUM('Executive','Regular Officer') NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (committee_id) REFERENCES committees(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_chat_committee (committee_id, created_at))"""))

    # Student roster and membership-fee tables; samples are added once on creation.
    def pay_tables():
        had_members = bool(_scalar("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() "
                                   "AND TABLE_NAME='members'"))
        execute("""CREATE TABLE IF NOT EXISTS members (
            member_id VARCHAR(20) PRIMARY KEY, full_name VARCHAR(120) NOT NULL,
            student_number VARCHAR(30) NOT NULL DEFAULT '', course VARCHAR(20) NOT NULL DEFAULT '',
            year_level TINYINT NOT NULL DEFAULT 1, email VARCHAR(120) NOT NULL DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'Active', member_type VARCHAR(20) NOT NULL DEFAULT 'Regular',
            position VARCHAR(60) NOT NULL DEFAULT '', membership_plan VARCHAR(20) NOT NULL DEFAULT '',
            section VARCHAR(30) NULL, fee_status VARCHAR(10) NOT NULL DEFAULT 'Pending')""")
        execute("""CREATE TABLE IF NOT EXISTS payments (
            id INT AUTO_INCREMENT PRIMARY KEY, payment_id VARCHAR(20) NULL UNIQUE,
            member_id VARCHAR(20) NOT NULL, amount DECIMAL(10,2) NOT NULL, paid_on DATE NOT NULL,
            method VARCHAR(20) NOT NULL, reference VARCHAR(40) NOT NULL DEFAULT '',
            received_by VARCHAR(80) NOT NULL DEFAULT '', note VARCHAR(200) NOT NULL DEFAULT '',
            status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
            recorded_by VARCHAR(100) NOT NULL DEFAULT '', approved_by VARCHAR(100) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE)""")
        if not had_members:
            for m in SAMPLE_MEMBERS:
                execute("INSERT IGNORE INTO members (member_id, full_name, student_number, course, year_level, email, "
                        "status, member_type, position, membership_plan, section, fee_status) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", m)
            for pid, mid, amt, d, meth, ref, rec, note in SAMPLE_PAYMENTS:
                execute("INSERT IGNORE INTO payments (payment_id, member_id, amount, paid_on, method, reference, "
                        "received_by, note, status, recorded_by, approved_by) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'Approved','Admin','Admin')",
                        (pid, mid, amt, d, meth, ref, rec, note))
    _step('members/payments', pay_tables)
    def payment_references():
        execute('ALTER TABLE payments MODIFY COLUMN reference VARCHAR(40) NULL')
        if _scalar("SELECT COUNT(*) FROM payments WHERE reference IS NULL OR reference<>LPAD(CAST(id AS CHAR),8,'0')"):
            execute("UPDATE payments SET reference=CONCAT('REF-',id)")
            execute("UPDATE payments SET reference=LPAD(CAST(id AS CHAR),8,'0')")
        if not _has_index('payments', 'uq_payments_reference'):
            execute('ALTER TABLE payments ADD UNIQUE KEY uq_payments_reference (reference)')
    _step('payments.reference', payment_references)
    # Older builds required a second executive approval even though only executives
    # could record a received payment. Treat those existing entries as collected.
    _step('payments.approval-removal', lambda: execute(
        "UPDATE payments SET status='Approved', approved_by=recorded_by "
        "WHERE status='Pending'"))

    # committee_assignments: no duplicates, no orphans
    def assignments():
        execute('DELETE a FROM committee_assignments a JOIN committee_assignments b '
                'ON a.user_id=b.user_id AND a.committee_id=b.committee_id AND a.id>b.id')
        if not _has_index('committee_assignments', 'uq_user_committee'):
            execute('ALTER TABLE committee_assignments ADD UNIQUE KEY uq_user_committee (user_id, committee_id)')
        if not _has_fk('committee_assignments', 'committee_assignments_ibfk_user'):
            execute('DELETE FROM committee_assignments WHERE user_id NOT IN (SELECT id FROM users)')
            execute('ALTER TABLE committee_assignments ADD CONSTRAINT committee_assignments_ibfk_user '
                    'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE')
    _step('committee_assignments', assignments)


def query(sql, args=(), one=False):
    con = pymysql.connect(**DB)
    try:
        with con.cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall()
            return (rows[0] if rows else None) if one else list(rows)
    finally: con.close()

def execute(sql, args=()):
    con = pymysql.connect(**DB)
    try:
        with con.cursor() as cur:
            cur.execute(sql, args)
            return cur.lastrowid
    finally: con.close()

def set_officer_id(user_id):
    officer_id = 'OFF-%06d' % int(user_id)
    execute('UPDATE users SET officer_id=%s WHERE id=%s', (officer_id, user_id))
    return officer_id

def valid_gmail(email):
    return bool(re.fullmatch(r'[a-z]+@gmail\.com', email))

def valid_full_name(name):
    return bool(re.fullmatch(r'[A-Za-z]+(?: [A-Za-z]+)*', name))

def pct(done, total): return round(100 * done / total) if total else 0
def err(msg, code):   return jsonify(error=msg), code

def notify(msg, user_id=None):
    try:
        execute('INSERT INTO notifications (user_id, message) VALUES (%s,%s)', (user_id, msg))
    except Exception:
        execute('INSERT INTO notifications (message) VALUES (%s)', (msg,))

ensure_schema()   # runs once at startup, after the DB helpers above exist

def default_event_id():
    """Event shown when nothing is selected: next upcoming one, else the most recent."""
    e = query("SELECT id FROM events ORDER BY (event_date>=CURDATE()) DESC, "
              "CASE WHEN event_date>=CURDATE() THEN event_date END ASC, event_date DESC LIMIT 1", one=True)
    return e['id'] if e else 0

def actor_label(user_id, role, committee_id):
    """How to describe the person who ticked a task: their committee, or 'Executive'."""
    own = query("SELECT 1 FROM committee_assignments WHERE user_id=%s AND committee_id=%s",
                (user_id, committee_id), one=True)
    if own:
        c = query("SELECT committee_name FROM committees WHERE id=%s", (committee_id,), one=True)
        return c['committee_name'] if c else role
    return 'Executive' if role == 'Executive' else role

def login_required(f):
    @wraps(f)
    def w(*a, **k):
        if 'user' not in session: return err('Please log in.', 401)
        return f(*a, **k)
    return w

def exec_required(f):
    @wraps(f)
    @login_required
    def w(*a, **k):
        if session['user']['role'] != 'Executive': return err('Executives only.', 403)
        return f(*a, **k)
    return w

@app.errorhandler(pymysql.MySQLError)
def db_error(e): return err(db_problem(e), 500)

@app.route('/')
def home(): return send_from_directory(app.static_folder, 'index.html')


# -- Auth ---------------------------------------------------------------------
@app.post('/api/auth/login')
def login():
    b = request.get_json(silent=True) or {}
    email, pw = (b.get('email') or '').strip().lower(), b.get('password') or ''
    if not email or not pw: return err('Enter your email and password.', 400)
    u = query('SELECT * FROM users WHERE email=%s', (email,), one=True)
    if not u or not check_password_hash(u['password_hash'], pw):
        return err('Incorrect email or password.', 401)
    if u.get('status', 'Approved') == 'Pending':
        return err('Access Denied: Your account is currently waiting for Administrator approval.', 403)
    session.permanent = True
    session['user'] = {
        'id':     u['id'],
        'officer_id': u['officer_id'],
        'name':   u['full_name'],
        'email':  u['email'],
        'role':   u['role'],
        'status': u['status']
    }
    return jsonify(session['user'])

@app.post('/api/auth/logout')
def logout(): session.clear(); return jsonify(ok=True)

@app.get('/api/auth/me')
def me():
    if 'user' not in session:
        return jsonify(error='Please log in.'), 401
    row = query('SELECT status FROM users WHERE id=%s', (session['user']['id'],), one=True)
    if row and row['status'] == 'Pending':
        session.clear()
        return jsonify(status='error', message='Waiting for Approval'), 401
    u = query('SELECT avatar, officer_id FROM users WHERE id=%s', (session['user']['id'],), one=True)
    resp = dict(session['user'])
    resp['avatar'] = u['avatar'] if u else None
    resp['officer_id'] = u['officer_id'] if u else None
    return jsonify(resp)


# -- Events -------------------------------------------------------------------
EVENT_COLS = ("id, event_name, COALESCE(description,'') AS description, CAST(event_date AS CHAR) AS event_date, "
              "CAST(COALESCE(event_end_date, event_date) AS CHAR) AS event_end_date, is_completed, "
              "(COALESCE(event_end_date,event_date)<CURDATE()) AS is_past")

@app.get('/api/events')
@login_required
def events():
    m = request.args.get('month', '')
    if not re.fullmatch(r'\d{4}-\d{2}', m):
        from datetime import date; m = date.today().strftime('%Y-%m')
    return jsonify(query("SELECT " + EVENT_COLS + " FROM events "
                         "WHERE DATE_FORMAT(event_date,'%%Y-%%m')=%s ORDER BY event_date", (m,)))

@app.get('/api/events/all')
@login_required
def events_all():
    """Every event (start + end date). The calendar uses this to ring event days in ANY month."""
    return jsonify(query("SELECT " + EVENT_COLS + " FROM events ORDER BY event_date, id"))


# -- Task helpers shared by the officer + executive boards ---------------------
TASK_COLS = ("t.id, t.task_name, t.status, t.committee_id, "
             "t.checked_by_name, t.checked_by_label, CAST(t.checked_at AS CHAR) AS checked_at")

def tasks_for(committee_id):
    return query("SELECT " + TASK_COLS + " FROM tasks t WHERE t.committee_id=%s ORDER BY t.id", (committee_id,))

def event_totals(event_id):
    r = query("""SELECT COUNT(t.id) AS total, COALESCE(SUM(t.status),0) AS done
                 FROM tasks t JOIN committees c ON c.id=t.committee_id
                 WHERE c.event_id=%s""", (event_id,), one=True)
    return int(r['done']), int(r['total'])

def committee_activity(committee_id, limit=10):
    return query("""SELECT tl.action, tl.task_name, tl.committee_name, tl.actor_name AS actor,
                           tl.actor_label, CAST(tl.created_at AS CHAR) AS created_at
                    FROM task_logs tl JOIN tasks t ON t.id=tl.task_id
                    WHERE t.committee_id=%s ORDER BY tl.created_at DESC, tl.id DESC LIMIT %s""",
                 (committee_id, limit))


# -- Officer dashboard --------------------------------------------------------
@app.get('/api/dashboard')
@login_required
def dashboard():
    """Everything an officer sees for ONE event: event-wide progress + ONLY their committee's tasks."""
    uid      = session['user']['id']
    event_id = request.args.get('eventId', type=int)
    if not event_id:
        assigned_event = query("""SELECT e.id FROM events e
                                  WHERE EXISTS (
                                      SELECT 1 FROM committees c
                                      JOIN committee_assignments ca ON ca.committee_id=c.id
                                      WHERE c.event_id=e.id AND ca.user_id=%s
                                  )
                                  ORDER BY (COALESCE(e.event_end_date,e.event_date)>=CURDATE()) DESC,
                                           CASE WHEN COALESCE(e.event_end_date,e.event_date)>=CURDATE()
                                                THEN e.event_date END ASC,
                                           e.event_date DESC, e.id DESC LIMIT 1""", (uid,), one=True)
        event_id = assigned_event['id'] if assigned_event else default_event_id()
    ev = query("SELECT id, event_name, COALESCE(description,'') AS description, CAST(event_date AS CHAR) AS event_date, "
               "CAST(COALESCE(event_end_date, event_date) AS CHAR) AS event_end_date, is_completed, "
               "(COALESCE(event_end_date,event_date)<CURDATE()) AS is_past "
               "FROM events WHERE id=%s", (event_id,), one=True)
    done, total = event_totals(event_id) if ev else (0, 0)
    base = dict(event=ev, progress=pct(done, total), done=done, total=total)

    com = query("""SELECT c.id, c.committee_name FROM committees c
                   JOIN committee_assignments ca ON ca.committee_id=c.id
                   WHERE ca.user_id=%s AND c.event_id=%s LIMIT 1""", (uid, event_id), one=True) if ev else None
    if not com:
        return jsonify(committee=None, tasks=[], members=[], activity=[],
                       committee_done=0, committee_total=0, committee_progress=0, **base)

    tasks   = tasks_for(com['id'])
    c_done  = sum(1 for t in tasks if t['status'])
    members = query("""SELECT u.full_name, u.officer_id, u.email FROM users u
                       JOIN committee_assignments ca ON ca.user_id=u.id
                       WHERE ca.committee_id=%s ORDER BY u.full_name""", (com['id'],))
    return jsonify(committee=com, tasks=tasks, members=members,
                   activity=committee_activity(com['id']),
                   committee_done=c_done, committee_total=len(tasks),
                   committee_progress=pct(c_done, len(tasks)), **base)


@app.patch('/api/tasks/<int:task_id>')
@login_required
def toggle_task(task_id):
    """Check / uncheck a task. Writes the audit columns AND a task_logs row, atomically.
    Officers may only touch tasks of THEIR committee; executives may touch any."""
    t = query("""SELECT t.committee_id, t.task_name, t.status, c.event_id, c.committee_name,
                        e.is_completed, (COALESCE(e.event_end_date,e.event_date)<CURDATE()) AS is_past
                 FROM tasks t JOIN committees c ON c.id=t.committee_id
                 JOIN events e ON e.id=c.event_id WHERE t.id=%s""",
              (task_id,), one=True)
    if not t: return err('Task not found.', 404)
    if t['is_completed'] or t['is_past']:
        return err('This event is done and no longer available. Tasks are view-only.', 409)
    u = session['user']
    if u['role'] != 'Executive':
        own = query("SELECT 1 FROM committee_assignments WHERE user_id=%s AND committee_id=%s",
                    (u['id'], t['committee_id']), one=True)
        if not own: return err('Not your committee.', 403)

    want   = 1 if (request.get_json(silent=True) or {}).get('status') else 0
    uid, uname = u['id'], u['name']
    cname, tname = t['committee_name'], t['task_name']
    label  = actor_label(uid, u['role'], t['committee_id'])
    action = 'completed' if want else 'uncompleted'

    con = pymysql.connect(**DB)
    changed = False
    try:
        con.begin()
        with con.cursor() as cur:
            cur.execute('SELECT NOW() AS happened_at')
            now = cur.fetchone()['happened_at']
            if want:
                # "AND status=0" makes a double-click / double-submit a harmless no-op
                changed = cur.execute("""UPDATE tasks SET status=1, checked_by_id=%s, checked_by_name=%s,
                                         checked_by_label=%s, checked_at=%s
                                         WHERE id=%s AND COALESCE(status,0)=0""",
                                      (uid, uname, label, now, task_id)) > 0
            else:
                changed = cur.execute("""UPDATE tasks SET status=0, checked_by_id=NULL, checked_by_name=NULL,
                                         checked_by_label=NULL, checked_at=NULL
                                         WHERE id=%s AND COALESCE(status,0)=1""", (task_id,)) > 0
            if changed:
                cur.execute("""INSERT INTO task_logs
                               (user_id, actor_name, actor_label, task_id, task_name, committee_name, action, created_at)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                            (uid, uname, label, task_id, tname, cname, action, now))
        con.commit()
    except Exception:
        con.rollback(); raise
    finally:
        con.close()

    if changed:
        verb = 'completed' if want else 'marked incomplete'
        msg  = f'{uname} {verb}: "{tname}" ({cname})'
        notify(msg)                                    # executives' org-wide feed
        for m in query('SELECT user_id FROM committee_assignments WHERE committee_id=%s', (t['committee_id'],)):
            if m['user_id'] != uid: notify(msg, m['user_id'])   # teammates
    return jsonify(ok=True, changed=changed)


# -- Notifications ------------------------------------------------------------
@app.get('/api/notifications')
@login_required
def get_notifications():
    u = session['user']
    cols = ("SELECT n.id, n.message, CAST(n.created_at AS CHAR) AS created_at, "
            "IF(r.notification_id IS NULL, 0, 1) AS is_read "
            "FROM notifications n LEFT JOIN notification_reads r "
            "ON r.notification_id=n.id AND r.user_id=%s ")
    if u['role'] == 'Executive':   # org-wide feed
        rows = query(cols + "WHERE n.user_id IS NULL ORDER BY n.created_at DESC, n.id DESC LIMIT 30", (u['id'],))
    else:                          # officers: ONLY messages addressed to them
        rows = query(cols + "WHERE n.user_id=%s ORDER BY n.created_at DESC, n.id DESC LIMIT 30", (u['id'], u['id']))
    return jsonify(rows)

@app.post('/api/notifications/read')
@login_required
def mark_notification_read():
    u = session['user']
    body = request.get_json(silent=True) or {}
    if body.get('all') is True:
        if u['role'] == 'Executive':
            execute("INSERT IGNORE INTO notification_reads (user_id, notification_id) "
                    "SELECT %s, id FROM notifications WHERE user_id IS NULL", (u['id'],))
        else:
            execute("INSERT IGNORE INTO notification_reads (user_id, notification_id) "
                    "SELECT %s, id FROM notifications WHERE user_id=%s", (u['id'], u['id']))
        return jsonify(ok=True)

    try:
        notification_id = int(body.get('notification_id'))
    except (TypeError, ValueError):
        return err('Choose a valid notification.', 400)
    if notification_id <= 0:
        return err('Choose a valid notification.', 400)
    if u['role'] == 'Executive':
        visible = query("SELECT id FROM notifications WHERE id=%s AND user_id IS NULL",
                        (notification_id,), one=True)
    else:
        visible = query("SELECT id FROM notifications WHERE id=%s AND user_id=%s",
                        (notification_id, u['id']), one=True)
    if not visible:
        return err('That notification was not found.', 404)
    execute("INSERT INTO notification_reads (user_id, notification_id) VALUES (%s,%s) "
            "ON DUPLICATE KEY UPDATE read_at=CURRENT_TIMESTAMP", (u['id'], notification_id))
    return jsonify(ok=True)


# -- Activity feed ------------------------------------------------------------
@app.get('/api/activity')
@login_required
def activity():
    uid = session['user']['id']
    event_id = request.args.get('eventId', type=int) or default_event_id()
    com = query("""SELECT c.id FROM committees c
                   JOIN committee_assignments ca ON ca.committee_id=c.id
                   WHERE ca.user_id=%s AND c.event_id=%s LIMIT 1""", (uid, event_id), one=True)
    return jsonify(committee_activity(com['id'], 15) if com else [])


# -- Executive ----------------------------------------------------------------
@app.get('/api/exec/progress')
@exec_required
def exec_progress():
    eid  = request.args.get('eventId', type=int) or None
    rows = query("""SELECT c.id, c.committee_name AS name,
                    COUNT(t.id) AS total, COALESCE(SUM(t.status),0) AS done
                    FROM committees c LEFT JOIN tasks t ON t.committee_id=c.id
                    WHERE (%s IS NULL OR c.event_id=%s)
                    GROUP BY c.id, c.committee_name ORDER BY c.committee_name""", (eid, eid))
    coms  = [{'id': r['id'], 'name': r['name'], 'total': int(r['total']),
               'done': int(r['done']), 'percent': pct(int(r['done']), int(r['total']))} for r in rows]
    total = sum(c['total'] for c in coms); done = sum(c['done'] for c in coms)
    event = query("SELECT id, event_name, CAST(event_date AS CHAR) AS event_date FROM events WHERE id=%s",
                  (eid,), one=True) if eid else None
    return jsonify(overall=pct(done, total), total=total, done=done, committees=coms, event=event)

@app.get('/api/exec/board')
@exec_required
def exec_board():
    """Executive view of ONE event: overall progress + every committee section with its tasks,
    members and audit info (who ticked it, when)."""
    event_id = request.args.get('eventId', type=int) or default_event_id()
    ev = query("SELECT id, event_name, COALESCE(description,'') AS description, CAST(event_date AS CHAR) AS event_date, "
               "CAST(COALESCE(event_end_date, event_date) AS CHAR) AS event_end_date, is_completed, "
               "(COALESCE(event_end_date,event_date)<CURDATE()) AS is_past "
               "FROM events WHERE id=%s", (event_id,), one=True)
    coms = query("SELECT id, committee_name AS name FROM committees WHERE event_id=%s ORDER BY committee_name",
                 (event_id,))
    all_done = all_total = 0
    for c in coms:
        c['tasks']   = tasks_for(c['id'])
        c['total']   = len(c['tasks'])
        c['done']    = sum(1 for t in c['tasks'] if t['status'])
        c['percent'] = pct(c['done'], c['total'])
        c['members'] = [f"{m['full_name']} ({m['officer_id']})" for m in query(
            """SELECT u.full_name, u.officer_id FROM users u JOIN committee_assignments ca ON ca.user_id=u.id
               WHERE ca.committee_id=%s ORDER BY u.full_name""", (c['id'],))]
        all_done += c['done']; all_total += c['total']
    return jsonify(event=ev, overall=pct(all_done, all_total), done=all_done, total=all_total, committees=coms)

@app.get('/api/exec/event-records')
@exec_required
def event_records():
    rows = query("""SELECT id, event_name, COALESCE(description,'') AS description,
                           CAST(event_date AS CHAR) AS event_date,
                           CAST(COALESCE(event_end_date,event_date) AS CHAR) AS event_end_date,
                           is_completed
                    FROM events
                    WHERE COALESCE(event_end_date,event_date)<CURDATE()
                    ORDER BY event_date DESC, id DESC""")
    for event in rows:
        event['done'], event['total'] = event_totals(event['id'])
    return jsonify(rows)

@app.patch('/api/exec/event-records/<int:event_id>/complete')
@exec_required
def complete_event_record(event_id):
    event = query("""SELECT event_name, is_completed,
                            (COALESCE(event_end_date,event_date)<CURDATE()) AS is_past
                     FROM events WHERE id=%s""", (event_id,), one=True)
    if not event: return err('Event not found.', 404)
    if not event['is_past']: return err('Only past events can be marked done.', 400)
    if not event['is_completed']:
        execute('UPDATE events SET is_completed=1 WHERE id=%s', (event_id,))
        notify(f'Event marked done: {event["event_name"]}.')
    return jsonify(ok=True, is_completed=True)

@app.get('/api/exec/meta')
@exec_required
def exec_meta():
    try:
        eid  = request.args.get('eventId', type=int) or None
        coms = (query("SELECT id, committee_name AS name FROM committees WHERE event_id=%s ORDER BY committee_name", (eid,))
                if eid else query("SELECT id, committee_name AS name FROM committees ORDER BY committee_name"))
        evs = query("SELECT id, event_name AS title, COALESCE(description,'') AS description, CAST(event_date AS CHAR) AS date, "
                    "CAST(event_end_date AS CHAR) AS end_date "
                    "FROM events ORDER BY event_date DESC")
        users   = query("SELECT id, full_name, officer_id FROM users WHERE status='Approved' ORDER BY full_name")
        pending = query("SELECT id, full_name, officer_id, email, role FROM users WHERE status='Pending' ORDER BY id ASC")
        assigns = (query("SELECT ca.user_id, ca.committee_id FROM committee_assignments ca "
                         "JOIN committees c ON c.id=ca.committee_id WHERE c.event_id=%s", (eid,))
                   if eid else [])
        return jsonify(committees=coms, events=evs, users=users, pending=pending, assignments=assigns)
    except Exception as ex:
        return err('Meta query failed: ' + str(ex), 500)

def backup_sql():
    def identifier(value):
        return '`%s`' % value.replace('`', '``')

    con = pymysql.connect(**DB)
    try:
        with con.cursor() as cur:
            cur.execute('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            con.begin()
            cur.execute('SHOW FULL TABLES')
            tables = [list(row.values())[0] for row in cur.fetchall()
                      if list(row.values())[1] == 'BASE TABLE']
            dependencies = {table: set() for table in tables}
            cur.execute("""SELECT TABLE_NAME, REFERENCED_TABLE_NAME
                           FROM information_schema.KEY_COLUMN_USAGE
                           WHERE TABLE_SCHEMA=%s AND REFERENCED_TABLE_NAME IS NOT NULL""", (DB_NAME,))
            for row in cur.fetchall():
                if row['TABLE_NAME'] in dependencies and row['REFERENCED_TABLE_NAME'] in dependencies:
                    dependencies[row['TABLE_NAME']].add(row['REFERENCED_TABLE_NAME'])

            order = []
            remaining = set(tables)
            while remaining:
                ready = sorted(table for table in remaining if not dependencies[table] & remaining)
                if not ready:
                    ready = [min(remaining)]
                order.extend(ready)
                remaining.difference_update(ready)

            definitions = {}
            for table in order:
                cur.execute('SHOW CREATE TABLE ' + identifier(table))
                definitions[table] = list(cur.fetchone().values())[1]

            lines = [
                '-- SOCCS Portal SQL backup',
                '-- Restore into the soccs_portal database using MySQL/MariaDB.',
                'SET NAMES utf8mb4;',
                'SET FOREIGN_KEY_CHECKS=0;',
                'CREATE DATABASE IF NOT EXISTS %s CHARACTER SET utf8mb4;' % identifier(DB_NAME),
                'USE %s;' % identifier(DB_NAME),
            ]
            lines.extend('DROP TABLE IF EXISTS %s;' % identifier(table) for table in reversed(order))
            lines.extend(definitions[table] + ';' for table in order)

            for table in order:
                cur.execute('SELECT * FROM ' + identifier(table))
                columns = [column[0] for column in cur.description]
                if not columns:
                    continue
                names = ', '.join(identifier(column) for column in columns)
                placeholders = ', '.join(['%s'] * len(columns))
                statement = 'INSERT INTO %s (%s) VALUES (%s);' % (
                    identifier(table), names, placeholders)
                for row in cur.fetchall():
                    lines.append(cur.mogrify(statement, tuple(row[column] for column in columns)))

            lines.append('SET FOREIGN_KEY_CHECKS=1;')
            return '\n\n'.join(lines) + '\n'
    finally:
        con.close()

@app.get('/api/exec/backup.sql')
@exec_required
def download_database_backup():
    dump = backup_sql().encode('utf-8')
    filename = 'soccs_portal_backup_%s.sql' % datetime.now().strftime('%Y%m%d_%H%M%S')
    return send_file(BytesIO(dump), mimetype='application/sql', as_attachment=True,
                     download_name=filename)

# Events CRUD
def valid_event_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False

@app.post('/api/exec/events')
@exec_required
def add_event():
    b = request.get_json(silent=True) or {}
    name     = b.get('event_name')
    event_date = b.get('event_date')
    end_date = b.get('event_end_date') or None
    description = (b.get('description') or '').strip()[:100]
    if not isinstance(name, str) or not name.strip() or not event_date:
        return err('Event name and date are required.', 400)
    name = name.strip()
    if len(name) > 120: return err('Event names can be up to 120 characters.', 400)
    if not valid_event_date(event_date): return err('Invalid start date.', 400)
    if end_date and not valid_event_date(end_date): return err('Invalid end date.', 400)
    if end_date and end_date < event_date: return err('End date cannot be before the start date.', 400)
    eid = execute('INSERT INTO events (event_name, description, event_date, event_end_date) VALUES (%s,%s,%s,%s)',
                  (name, description or None, event_date, end_date))
    notify(f'New event created: {name}')
    return jsonify(id=eid)

@app.put('/api/exec/events/<int:eid>')
@exec_required
def update_event(eid):
    b = request.get_json(silent=True) or {}
    name = b.get('event_name')
    event_date = b.get('event_date')
    end_date = b.get('event_end_date') or None
    description = (b.get('description') or '').strip()[:100]
    if not isinstance(name, str) or not name.strip() or not event_date:
        return err('Event name and date are required.', 400)
    name = name.strip()
    if len(name) > 120: return err('Event names can be up to 120 characters.', 400)
    if not valid_event_date(event_date): return err('Invalid start date.', 400)
    if end_date and not valid_event_date(end_date): return err('Invalid end date.', 400)
    if end_date and end_date < event_date: return err('End date cannot be before the start date.', 400)
    event = query('SELECT id FROM events WHERE id=%s', (eid,), one=True)
    if not event: return err('Event not found.', 404)
    execute('UPDATE events SET event_name=%s, description=%s, event_date=%s, event_end_date=%s WHERE id=%s',
            (name, description or None, event_date, end_date, eid))
    notify(f'Event updated: {name}')
    return jsonify(ok=True)

@app.delete('/api/exec/events/<int:eid>')
@exec_required
def delete_event(eid):
    ev = query("""SELECT event_name, is_completed,
                        (COALESCE(event_end_date,event_date)<CURDATE()) AS is_past
                 FROM events WHERE id=%s""", (eid,), one=True)
    if not ev: return err('Event not found.', 404)
    if ev['is_completed'] or ev['is_past']: return err('This event is done and no longer available.', 409)
    execute('DELETE FROM events WHERE id=%s', (eid,))
    notify(f'Event deleted: {ev["event_name"]}')
    return jsonify(ok=True)

# Committees CRUD
@app.post('/api/exec/committees')
@exec_required
def add_committee():
    b = request.get_json(silent=True) or {}
    name, eid = (b.get('committee_name') or '').strip(), b.get('event_id')
    if not name or not eid: return err('Committee name and event are required.', 400)
    ev = query('SELECT event_name FROM events WHERE id=%s', (eid,), one=True)
    if not ev: return err('Event not found.', 404)
    if query('SELECT 1 FROM committees WHERE event_id=%s AND LOWER(committee_name)=LOWER(%s)', (eid, name), one=True):
        return err('That event already has a committee with this name.', 409)
    cid = execute('INSERT INTO committees (committee_name, event_id) VALUES (%s,%s)', (name, eid))
    notify(f'Committee "{name}" created for {ev["event_name"]}.')
    return jsonify(id=cid)

@app.delete('/api/exec/committees/<int:cid>')
@exec_required
def delete_committee(cid):
    c = query("""SELECT c.committee_name, e.is_completed,
                        (COALESCE(e.event_end_date,e.event_date)<CURDATE()) AS is_past
                 FROM committees c JOIN events e ON e.id=c.event_id WHERE c.id=%s""", (cid,), one=True)
    if not c: return err('Committee not found.', 404)
    if c['is_completed'] or c['is_past']: return err('This event is done and no longer available.', 409)
    execute('DELETE FROM committees WHERE id=%s', (cid,))
    return jsonify(ok=True)

# Tasks
@app.get('/api/exec/tasks')
@exec_required
def list_tasks():
    eid = request.args.get('eventId', type=int) or None
    if eid:
        rows = query("""
            SELECT t.id, t.task_name, t.status, c.committee_name
            FROM tasks t JOIN committees c ON c.id=t.committee_id
            WHERE c.event_id=%s ORDER BY c.committee_name, t.id""", (eid,))
    else:
        rows = query("""
            SELECT t.id, t.task_name, t.status, c.committee_name
            FROM tasks t JOIN committees c ON c.id=t.committee_id
            ORDER BY c.committee_name, t.id""")
    return jsonify(rows)

@app.post('/api/exec/tasks')
@exec_required
def add_task():
    b = request.get_json(silent=True) or {}
    name = (b.get('task_name') or '').strip()
    if not name or not b.get('committee_id'): return err('Fill in every field.', 400)
    c = query("""SELECT c.committee_name, e.is_completed,
                        (COALESCE(e.event_end_date,e.event_date)<CURDATE()) AS is_past
                 FROM committees c JOIN events e ON e.id=c.event_id WHERE c.id=%s""", (b['committee_id'],), one=True)
    if not c: return err('Committee not found.', 404)
    if c['is_completed'] or c['is_past']: return err('This event is done and no longer available.', 409)
    tid = execute('INSERT INTO tasks (task_name, status, committee_id) VALUES (%s,0,%s)',
                  (name[:200], b['committee_id']))
    notify(f'Task "{name}" added to {c["committee_name"]}.')
    return jsonify(id=tid)

@app.delete('/api/exec/tasks/<int:tid>')
@exec_required
def delete_task(tid):
    task = query("""SELECT e.is_completed,
                           (COALESCE(e.event_end_date,e.event_date)<CURDATE()) AS is_past
                    FROM tasks t JOIN committees c ON c.id=t.committee_id
                    JOIN events e ON e.id=c.event_id WHERE t.id=%s""", (tid,), one=True)
    if not task: return err('Task not found.', 404)
    if task['is_completed'] or task['is_past']: return err('This event is done and no longer available.', 409)
    execute('DELETE FROM tasks WHERE id=%s', (tid,))
    return jsonify(ok=True)

# Assign officer
@app.post('/api/exec/assign')
@exec_required
def assign():
    b = request.get_json(silent=True) or {}
    uid, cid = b.get('user_id'), b.get('committee_id')
    if not uid or not cid: return err('Pick an officer and a committee.', 400)
    user = query("SELECT id FROM users WHERE id=%s AND status='Approved'", (uid,), one=True)
    if not user: return err('Approved officer not found.', 404)
    committee = query('SELECT id, event_id FROM committees WHERE id=%s', (cid,), one=True)
    if not committee: return err('Committee not found.', 404)
    event = query("""SELECT is_completed, (COALESCE(event_end_date,event_date)<CURDATE()) AS is_past
                     FROM events WHERE id=%s""", (committee['event_id'],), one=True)
    if event and (event['is_completed'] or event['is_past']):
        return err('This event is done and no longer available.', 409)
    execute(
        '''DELETE ca FROM committee_assignments ca
           JOIN committees c ON c.id = ca.committee_id
           WHERE ca.user_id = %s AND c.event_id = %s''',
        (uid, committee['event_id']))
    execute('INSERT IGNORE INTO committee_assignments (user_id, committee_id) VALUES (%s,%s)', (uid, cid))
    u = query('SELECT full_name FROM users WHERE id=%s', (uid,), one=True)
    c = query('SELECT committee_name FROM committees WHERE id=%s', (cid,), one=True)
    uname = u["full_name"] if u else "Officer"
    cname = c["committee_name"] if c else "committee"
    ev = query('SELECT e.event_name FROM events e JOIN committees c ON c.event_id=e.id WHERE c.id=%s', (cid,), one=True)
    evname = ev['event_name'] if ev else 'an event'
    notify(f'{uname} assigned to {cname} ({evname}).')
    notify(f'You have been assigned to the {cname} committee for {evname}.', uid)
    return jsonify(ok=True)

# -- Chat --------------------------------------------------------------------
@app.get('/api/chat/<int:committee_id>')
@login_required
def get_chat(committee_id):
    u = session['user']
    if u['role'] != 'Executive':
        own = query('SELECT 1 FROM committee_assignments WHERE user_id=%s AND committee_id=%s',
                    (u['id'], committee_id), one=True)
        if not own: return err('Not your committee.', 403)
    rows = query("""SELECT cm.id, cm.sender_name, cm.sender_role, cm.message,
                          CAST(cm.created_at AS CHAR) AS created_at,
                          u.avatar
                   FROM chat_messages cm JOIN users u ON u.id=cm.user_id
                   WHERE cm.committee_id=%s ORDER BY cm.created_at ASC, cm.id ASC LIMIT 80""",
                 (committee_id,))
    return jsonify(rows)

@app.post('/api/chat/<int:committee_id>')
@login_required
def post_chat(committee_id):
    u = session['user']
    if u['role'] != 'Executive':
        own = query('SELECT 1 FROM committee_assignments WHERE user_id=%s AND committee_id=%s',
                    (u['id'], committee_id), one=True)
        if not own: return err('Not your committee.', 403)
    b = request.get_json(silent=True) or {}
    msg = (b.get('message') or '').strip()
    if not msg: return err('Message cannot be empty.', 400)
    if len(msg) > 1000: return err('Message too long.', 400)
    execute('INSERT INTO chat_messages (committee_id, user_id, sender_name, sender_role, message) VALUES (%s,%s,%s,%s,%s)',
            (committee_id, u['id'], u['name'], u['role'], msg[:1000]))
    return jsonify(ok=True)

# List all approved members
@app.get('/api/exec/members')
@exec_required
def list_members():
    rows = query("SELECT id, officer_id, full_name, email, role FROM users WHERE status='Approved' ORDER BY full_name")
    return jsonify(rows)

# Member account roster and executive approval queue.
@app.get('/api/members')
@login_required
def member_accounts():
    rows = query("SELECT id, officer_id, full_name, email, role FROM users "
                 "WHERE status='Approved' ORDER BY id ASC")
    pending = []
    is_exec = session['user']['role'] == 'Executive'
    if is_exec:
        pending = query("SELECT id, officer_id, full_name, email, role FROM users "
                        "WHERE status='Pending' ORDER BY id ASC")
    return jsonify(members=rows, pending=pending, permissions={'manage': is_exec})

# Officers and executives can submit accounts, but all requests require executive approval.
@app.post('/api/members/requests')
@login_required
def request_member_account():
    b = request.get_json(silent=True) or {}
    name = str(b.get('full_name') or '').strip()
    email = str(b.get('email') or '').strip().lower()
    password = b.get('password') or ''
    if (not valid_full_name(name) or len(name) > 100 or not valid_gmail(email)
            or not isinstance(password, str) or len(password) < 8):
        return err('Enter a letters-only name, a letters-only Gmail address, and a password with at least 8 characters.', 400)
    is_exec = session['user']['role'] == 'Executive'
    status = 'Approved' if is_exec else 'Pending'
    try:
        uid = execute(
            "INSERT INTO users (full_name,email,password_hash,role,status) VALUES (%s,%s,%s,'Regular Officer',%s)",
            (name, email, generate_password_hash(password), status))
        set_officer_id(uid)
    except pymysql.err.IntegrityError:
        return err('That email is already registered.', 409)
    if is_exec:
        notify(f'New member account added: {name} (Regular Officer).')
        notify(f'Welcome to SOCCS Portal, {name}! Your account is ready.', uid)
    else:
        notify(f'New member request from {name} ({email}) -- awaiting executive approval.')
    return jsonify(id=uid, status=status)

# Remove a member account
@app.delete('/api/exec/users/<int:uid>')
@exec_required
def remove_user(uid):
    if uid == session['user']['id']: return err('You cannot remove your own account.', 400)
    u = query('SELECT full_name FROM users WHERE id=%s', (uid,), one=True)
    if not u: return err('User not found.', 404)
    execute('DELETE FROM users WHERE id=%s', (uid,))
    notify(f'Account removed: {u["full_name"]}.')
    return jsonify(ok=True)

# Change a member's role
@app.patch('/api/exec/users/<int:uid>/role')
@exec_required
def change_role(uid):
    if uid == session['user']['id']: return err('You cannot change your own role.', 400)
    b = request.get_json(silent=True) or {}
    role = b.get('role')
    if role not in ('Executive', 'Regular Officer'): return err('Invalid role.', 400)
    u = query('SELECT full_name FROM users WHERE id=%s', (uid,), one=True)
    if not u: return err('User not found.', 404)
    execute('UPDATE users SET role=%s WHERE id=%s', (role, uid))
    notify(f'{u["full_name"]} role changed to {role}.')
    notify(f'Your role has been updated to {role}.', uid)
    return jsonify(ok=True)

# Approve a pending user
@app.post('/api/admin/approve/<int:user_id>')
@exec_required
def approve_user(user_id):
    u = query('SELECT full_name, status FROM users WHERE id=%s', (user_id,), one=True)
    if not u: return err('User not found.', 404)
    if u.get('status') == 'Approved': return err('User is already approved.', 409)
    execute("UPDATE users SET status='Approved' WHERE id=%s", (user_id,))
    notify(f'{u["full_name"]} account approved by executive.')
    notify('Your account has been approved! You can now log in.', user_id)
    return jsonify(ok=True)

# Disapprove a pending account request. Removing it also frees the email to be used again.
@app.delete('/api/admin/requests/<int:user_id>')
@exec_required
def reject_user_request(user_id):
    u = query("SELECT full_name, status FROM users WHERE id=%s", (user_id,), one=True)
    if not u: return err('Request not found.', 404)
    if u['status'] != 'Pending': return err('Only pending requests can be disapproved.', 409)
    execute('DELETE FROM users WHERE id=%s', (user_id,))
    notify(f'Member request disapproved: {u["full_name"]}.')
    return jsonify(ok=True)

# Invite / create user
@app.post('/api/exec/users')
@exec_required
def invite():
    b = request.get_json(silent=True) or {}
    name  = (b.get('full_name') or '').strip()
    email = (b.get('email') or '').strip().lower()
    pw    = b.get('password') or ''
    role  = b.get('role', 'Regular Officer')
    if not valid_full_name(name) or not valid_gmail(email) or len(pw) < 8:
        return err('A letters-only name, a letters-only Gmail address, and an 8+ character password are required.', 400)
    if role not in ('Executive', 'Regular Officer'): return err('Invalid role.', 400)
    try:
        uid = execute(
            'INSERT INTO users (full_name,email,password_hash,role,status) VALUES (%s,%s,%s,%s,%s)',
            (name, email, generate_password_hash(pw), role, 'Approved'))
        set_officer_id(uid)
    except pymysql.err.IntegrityError:
        return err('That email is already registered.', 409)
    if b.get('committee_id'):
        execute('INSERT INTO committee_assignments (user_id,committee_id) VALUES (%s,%s)', (uid, b['committee_id']))
    notify(f'New member account added: {name} ({role}).')
    notify(f'Welcome to SOCCS Portal, {name}! Your account is ready.', uid)
    return jsonify(id=uid, status='Approved')


# -- Public registration ------------------------------------------------------
@app.post('/api/auth/register')
def register():
    b = request.get_json(silent=True) or {}
    name  = (b.get('full_name') or '').strip()
    email = (b.get('email') or '').strip().lower()
    pw    = b.get('password') or ''
    if not valid_full_name(name) or not valid_gmail(email) or len(pw) < 8:
        return err('A letters-only name, a letters-only Gmail address, and an 8+ character password are required.', 400)
    try:
        uid = execute(
            'INSERT INTO users (full_name,email,password_hash,role,status) VALUES (%s,%s,%s,%s,%s)',
            (name, email, generate_password_hash(pw), 'Regular Officer', 'Pending'))
        set_officer_id(uid)
    except pymysql.err.IntegrityError:
        return err('That email is already registered.', 409)
    notify(f'New account request from {name} ({email}) -- awaiting approval.')
    return jsonify(ok=True)

# -- Avatar ------------------------------------------------------------------
@app.post('/api/auth/avatar')
@login_required
def save_avatar():
    b = request.get_json(silent=True) or {}
    data = b.get('avatar') or ''
    if not data.startswith('data:image/'): return err('Invalid image data.', 400)
    if len(data) > 2_000_000: return err('Image too large (max ~1.5 MB).', 400)
    execute('UPDATE users SET avatar=%s WHERE id=%s', (data, session['user']['id']))
    return jsonify(ok=True)

# -- Change password ----------------------------------------------------------
@app.post('/api/auth/change-password')
@login_required
def change_password():
    b = request.get_json(silent=True) or {}
    old_pw = b.get('old_password') or ''
    new_pw = b.get('new_password') or ''
    if len(new_pw) < 8: return err('New password must be at least 8 characters.', 400)
    u = query('SELECT * FROM users WHERE id=%s', (session['user']['id'],), one=True)
    if not u or not check_password_hash(u['password_hash'], old_pw):
        return err('Current password is incorrect.', 401)
    execute('UPDATE users SET password_hash=%s WHERE id=%s',
            (generate_password_hash(new_pw), u['id']))
    return jsonify(ok=True)

# -- Edit profile -------------------------------------------------------------
@app.post('/api/auth/edit-profile')
@login_required
def edit_profile():
    b = request.get_json(silent=True) or {}
    name  = (b.get('full_name') or '').strip()
    email = (b.get('email') or '').strip().lower()
    current = query('SELECT email FROM users WHERE id=%s', (session['user']['id'],), one=True)
    if (not valid_full_name(name) or len(name) > 100 or len(email) > 120
            or (current and email != current['email'] and not valid_gmail(email))):
        return err('Use letters only in the full name and, when changing email, a letters-only Gmail address.', 400)
    try:
        execute('UPDATE users SET full_name=%s, email=%s WHERE id=%s',
                (name, email, session['user']['id']))
    except pymysql.err.IntegrityError:
        return err('That email is already in use.', 409)
    session['user'] = {**session['user'], 'name': name, 'email': email}
    return jsonify(ok=True)


# -- Payments -----------------------------------------------------------------
# Executive-recorded payments count as collected funds immediately.
def can_manage_payments():  return session['user']['role'] == 'Executive'

def annual_dues(m):
    return DEFAULT_DUES

def ledger_status(due, paid):
    if paid + 0.001 >= due: return 'Paid'
    if paid > 0: return 'Partial'
    return 'Pending'

def pay_row(p):
    return {'payment_id': p['payment_id'], 'member_id': p['member_id'], 'amount': float(p['amount']),
            'date': p['paid_on'], 'method': p['method'], 'reference': p['reference'],
            'received_by': p['received_by'], 'note': p['note'], 'status': p['status'],
            'recorded_by': p['recorded_by'], 'approved_by': p['approved_by']}

def all_payments():
    return [pay_row(p) for p in query("SELECT payment_id, member_id, amount, CAST(paid_on AS CHAR) AS paid_on, "
                                      "method, reference, received_by, note, status, recorded_by, approved_by "
                                      "FROM payments ORDER BY id")]

def build_ledger(members, payments):
    approved = {}
    for p in payments:
        if p['status'] != 'Approved': continue
        approved[p['member_id']] = round(approved.get(p['member_id'], 0) + p['amount'], 2)
    rows = []
    for m in members:
        due  = annual_dues(m)
        paid = approved.get(m['member_id'], 0)
        rows.append({
            'member_id': m['member_id'], 'full_name': m['full_name'], 'course': m['course'],
            'student_number': m['student_number'],
            'year_level': m['year_level'], 'member_type': m['member_type'],
            'member_status': m['status'],
            'annual_dues': due, 'amount_paid': paid,
            'balance': 0 if due <= 0 else round(max(due - paid, 0), 2),
            'payment_status': ledger_status(due, paid), 'section': m['section'] or 'Unassigned'})
    return rows

def section_totals(rows):
    t = {}
    for r in rows:
        section = r['section'] or 'Unassigned'
        b = t.setdefault(section, {'section': section, 'collected': 0, 'outstanding': 0})
        b['collected']   = round(b['collected'] + r['amount_paid'], 2)
        b['outstanding'] = round(b['outstanding'] + r['balance'], 2)
    return sorted(t.values(), key=lambda x: x['section'].casefold())

@app.get('/api/payments')
@login_required
def payments_list():
    q       = (request.args.get('q') or '').strip().casefold()
    section = request.args.get('section') or ''
    pstatus = request.args.get('pay_status') or ''
    members  = query('SELECT * FROM members ORDER BY member_id')
    payments = all_payments()
    filtered = members
    if q:      filtered = [m for m in filtered if q in ' '.join([m['full_name'], m['student_number'], m['member_id']]).casefold()]
    if section: filtered = [m for m in filtered if (m['section'] or '') == section]
    all_rows = build_ledger(members, payments)
    rows = build_ledger(filtered, payments)
    if pstatus: rows = [r for r in rows if r['payment_status'] == pstatus]
    rows.sort(key=lambda r: ((r['section'] or 'Unassigned').casefold(), r['full_name'].casefold()))
    ids   = {r['member_id'] for r in rows}
    names = {m['member_id']: m['full_name'] for m in members}
    visible = [{**p, 'member_name': names.get(p['member_id'], '')} for p in payments if p['member_id'] in ids]
    visible.sort(key=lambda p: (p['date'], p['payment_id'] or ''), reverse=True)
    summary = {
        'collected':   round(sum(r['amount_paid'] for r in rows), 2),
        'outstanding': round(sum(r['balance'] for r in rows), 2),
        'waived':      sum(1 for r in rows if r['payment_status'] == 'Waived'),
    }
    is_exec = can_manage_payments()
    ledger = rows if is_exec else [
        {key: row[key] for key in ('member_id', 'full_name', 'student_number', 'section',
                                   'member_status', 'payment_status')}
        for row in rows
    ]
    response = {
        'ledger': ledger,
        'permissions': {'record': is_exec},
        'funds': round(sum(r['amount_paid'] for r in all_rows), 2),
        'options': {
            'sections': sorted({m['section'] for m in members if m['section']}, key=str.casefold),
            'ledger_statuses': LEDGER_STATUSES,
        },
    }
    if is_exec:
        response.update(
            payments=visible, summary=summary,
            by_section=section_totals(all_rows), school_year=SCHOOL_YEAR,
            choices=[{'member_id': m['member_id'], 'student_number': m['student_number'],
                      'full_name': m['full_name'], 'annual_dues': annual_dues(m)} for m in members
                     if m['status'] == 'Active'],
        )
    return jsonify(response)

@app.get('/api/payments/members/roster')
@exec_required
def fee_member_roster():
    rows = query("SELECT member_id, full_name, student_number, COALESCE(section, '') AS section, status "
                 "FROM members ORDER BY section, full_name")
    return jsonify(members=rows)

@app.put('/api/payments/sections')
@exec_required
def fee_section_rename():
    b = request.get_json(silent=True) or {}
    old_section = str(b.get('section') or '').strip()
    new_section = str(b.get('new_section') or '').strip()
    if not old_section or len(old_section) > 30:
        return err('Choose a valid current section.', 400)
    if not new_section or len(new_section) > 30:
        return err('Enter a new section name up to 30 characters.', 400)
    count = query("SELECT COUNT(*) AS count FROM members WHERE section=%s", (old_section,), one=True)['count']
    if not count:
        return err('No students were found in that section.', 404)
    execute("UPDATE members SET section=%s WHERE section=%s", (new_section, old_section))
    return jsonify(updated=count, message='%d student(s) moved to %s.' % (count, new_section))

@app.put('/api/payments/members/<member_id>')
@exec_required
def fee_member_update(member_id):
    b = request.get_json(silent=True) or {}
    full_name = str(b.get('full_name') or '').strip()
    student_number = str(b.get('student_number') or '').strip()
    section = str(b.get('section') or '').strip()
    status = str(b.get('status') or '').strip()
    if not valid_full_name(full_name) or len(full_name) > 120:
        return err('Enter a student name using letters and spaces only (up to 120 characters).', 400)
    if not student_number or len(student_number) > 30:
        return err('Enter a student number up to 30 characters.', 400)
    if len(section) > 30:
        return err('Section names can be up to 30 characters.', 400)
    if status not in ('Active', 'Dropped'):
        return err('Student status must be Active or Dropped.', 400)
    member = query('SELECT member_id FROM members WHERE member_id=%s', (member_id,), one=True)
    if not member:
        return err('That student was not found.', 404)
    duplicate = query("SELECT member_id FROM members WHERE student_number=%s AND member_id<>%s LIMIT 1",
                      (student_number, member_id), one=True)
    if duplicate:
        return err('That student number is already assigned to another student.', 409)
    execute("UPDATE members SET full_name=%s, student_number=%s, section=%s, status=%s WHERE member_id=%s",
            (full_name, student_number, section or None, status, member_id))
    return jsonify(message='Student record updated.')

@app.post('/api/payments/members/import')
@exec_required
def import_fee_members():
    b = request.get_json(silent=True) or {}
    section = str(b.get('section') or '').strip()
    students = b.get('students')
    if not section or len(section) > 30:
        return err('Enter a section name (up to 30 characters).', 400)
    if not isinstance(students, list) or not students or len(students) > 500:
        return err('Paste between 1 and 500 student rows.', 400)

    validated = []
    seen_numbers = set()
    for index, student in enumerate(students, start=1):
        if not isinstance(student, dict):
            return err('Student row %d is invalid.' % index, 400)
        student_number = str(student.get('student_number') or '').strip()
        full_name = str(student.get('full_name') or '').strip()
        if (not student_number or len(student_number) > 30
            or not valid_full_name(full_name) or len(full_name) > 120):
            return err('Row %d needs a student number (up to 30 characters) and name (up to 120 characters).' % index, 400)
        if student_number.casefold() in seen_numbers:
            return err('Student number %s appears more than once in the pasted list.' % student_number, 400)
        seen_numbers.add(student_number.casefold())
        validated.append((student_number, full_name))

    added = updated = 0
    for student_number, full_name in validated:
        existing = query('SELECT member_id FROM members WHERE student_number=%s LIMIT 1',
                         (student_number,), one=True)
        if existing:
            execute("UPDATE members SET full_name=%s, section=%s, status='Active' WHERE member_id=%s",
                    (full_name, section, existing['member_id']))
            updated += 1
            continue
        member_id = secrets.token_hex(10)
        while query('SELECT 1 FROM members WHERE member_id=%s', (member_id,), one=True):
            member_id = secrets.token_hex(10)
        execute("INSERT INTO members (member_id, full_name, student_number, section, status, member_type, membership_plan) "
                "VALUES (%s,%s,%s,%s,'Active','Regular','Standard')",
                (member_id, full_name, student_number, section))
        added += 1

    return jsonify(added=added, updated=updated,
                   message='%d student(s) added and %d updated in %s.' % (added, updated, section))

def parse_amount(v):
    try:
        s = str(v or '').strip().lower()
        if s in ('nan', 'inf', '-inf', 'infinity', '-infinity'):
            raise ValueError()
        n = round(float(s), 2)
    except (TypeError, ValueError):
        raise ValueError('Amount must be a number.')
    if n <= 0: raise ValueError('Amount must be greater than 0.')
    return n

@app.post('/api/payments')
@login_required
def payment_create():
    if not can_manage_payments(): return err('Only executives can record payments.', 403)
    b = request.get_json(silent=True) or {}
    member_id = str(b.get('member_id', '')).strip()
    method    = str(b.get('method', '')).strip()
    date      = str(b.get('date', '')).strip()[:10]
    try: amount = parse_amount(b.get('amount'))
    except ValueError as e: return err(str(e), 400)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date): return err('Use a date in YYYY-MM-DD format.', 400)
    try:
        from datetime import date as _d; _d(*[int(x) for x in date.split('-')])
    except ValueError: return err('That date is not valid.', 400)
    if method not in PAYMENT_METHODS: return err('Choose cash, GCash, or bank transfer.', 400)
    m = query('SELECT full_name, status FROM members WHERE member_id=%s', (member_id,), one=True)
    if not m: return err('That member was not found.', 404)
    if m['status'] != 'Active': return err('Payments cannot be recorded for a dropped student.', 400)
    u = session['user']
    rid = execute("INSERT INTO payments (member_id, amount, paid_on, method, received_by, note, status, recorded_by, approved_by) "
                  "VALUES (%s,%s,%s,%s,%s,%s,'Approved',%s,%s)",
                  (member_id, amount, date, method,
                   (str(b.get('received_by') or u['name']).strip())[:80], str(b.get('note', '')).strip()[:200],
                   u['name'], u['name']))
    pid = 'PAY-%d' % rid
    execute('UPDATE payments SET payment_id=%s, reference=%s WHERE id=%s', (pid, '%08d' % rid, rid))
    p = next(x for x in all_payments() if x['payment_id'] == pid)
    return jsonify(payment=p, message='Membership fee recorded and added to total funds.')

# -- Committee members endpoint (used by chat panel) -------------------------
@app.get('/api/committees/<int:committee_id>/members')
@login_required
def committee_members(committee_id):
    u = session['user']
    if u['role'] != 'Executive':
        own = query('SELECT 1 FROM committee_assignments WHERE user_id=%s AND committee_id=%s',
                    (u['id'], committee_id), one=True)
        if not own: return err('Not your committee.', 403)
    rows = query("""SELECT u.full_name AS name, u.email, u.role
                   FROM users u
                   JOIN committee_assignments ca ON ca.user_id=u.id
                   WHERE ca.committee_id=%s AND u.status='Approved'
                   UNION
                   SELECT u.full_name AS name, u.email, u.role
                   FROM users u
                   WHERE u.role='Executive' AND u.status='Approved'
                   ORDER BY name""", (committee_id,))
    return jsonify(rows)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=os.environ.get('FLASK_DEBUG', '0') == '1')
