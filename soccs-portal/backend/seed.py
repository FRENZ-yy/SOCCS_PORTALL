"""
Seed demo accounts.
Run ONCE after importing database/schema.sql:
    cd backend
    python seed.py
"""
from werkzeug.security import generate_password_hash
from app import execute, query
from app import execute, query, set_officer_id

USERS = [
    # (full_name,          email,                  role,             status,    committee_name)
    ('Admin Executive',   'admin@soccs.edu',       'Executive',      'Approved', None),
    ('Eli Executive',     'exec@soccs.edu',        'Executive',      'Approved', None),
    ('Olivia Officer',    'officer@soccs.edu',     'Regular Officer','Approved', 'Logistics'),
    ('Liam Logistics',    'liam@soccs.edu',        'Regular Officer','Approved', 'Logistics'),
    ('Cara Creative',     'cara@soccs.edu',        'Regular Officer','Approved', 'Creatives'),
]

for full_name, email, role, status, com_name in USERS:
    execute(
        '''INSERT INTO users (full_name, email, password_hash, role, status)
           VALUES (%s, %s, %s, %s, %s)
           ON DUPLICATE KEY UPDATE
             password_hash = VALUES(password_hash),
             role          = VALUES(role),
             status        = VALUES(status)''',
        (full_name, email, generate_password_hash('password123'), role, status)
    )
    user = query('SELECT id FROM users WHERE email=%s', (email,), one=True)
    if user:
        set_officer_id(user['id'])
    if com_name:
        execute(
            '''INSERT IGNORE INTO committee_assignments (user_id, committee_id)
               SELECT u.id, c.id
               FROM users u, committees c
               WHERE u.email = %s AND c.committee_name = %s AND c.event_id = 1''',
            (email, com_name)
        )

# Committees differ per event, so people can sit on a different committee in each event.
# (user email, committee name, event name)
EVENT_ASSIGNMENTS = [
    ('liam@soccs.edu',    'Presentations', 'General Assembly'),
    ('cara@soccs.edu',    'Logistics',     'General Assembly'),
    ('officer@soccs.edu', 'Presentations', 'General Assembly'),
]
for email, com_name, ev_name in EVENT_ASSIGNMENTS:
    execute(
        '''INSERT IGNORE INTO committee_assignments (user_id, committee_id)
           SELECT u.id, c.id
           FROM users u, committees c JOIN events e ON e.id = c.event_id
           WHERE u.email = %s AND c.committee_name = %s AND e.event_name = %s''',
        (email, com_name, ev_name)
    )

print('Seeded successfully.')
print()
print('  Admin exec  →  admin@soccs.edu   /  password123')
print('  Alt exec    →  exec@soccs.edu    /  password123')
print('  Officer     →  officer@soccs.edu /  password123')
