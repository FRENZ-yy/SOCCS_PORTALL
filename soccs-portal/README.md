# SOCCS Portal — Flask + MySQL (XAMPP)

## Setup

1. **XAMPP** — Start **MySQL** only. In phpMyAdmin → Import → `database/schema.sql`.
2. **Python 3** — Ensure it's on PATH.
3. **Terminal:**
   ```
   cd backend
   pip install -r requirements.txt
   python seed.py
   python app.py
   ```
4. Open **http://localhost:5000**

## Background image
Place your image at `public/assets/background.png`. The CSS references it automatically.

## Demo logins (password: `password123`)
| Email | Role |
|---|---|
| exec@soccs.edu | Executive |
| officer@soccs.edu | Regular Officer |
| liam@soccs.edu | Regular Officer |
| cara@soccs.edu | Regular Officer |

## Features
- **Calendar that encircles what matters** — today gets a bright ring, every day that has an organization event gets a glowing ring (gold for fests), in *every* month you browse to. Multi-day events ring every day of the range.
- **Tap a date = filter everything** — the tapped date decides the event. The progress ring + bar, committee sections and tasks all switch to that event. A day with no event shows a clear "No event on …" state. Two events on one day → a picker.
- **Committees belong to an event** — each event has its own committees, tasks and members. An officer sees and ticks **only their own committee's tasks** for the selected event; executives see every committee of the event (with per-committee progress) and can tick any task.
- **Dynamic progress** — `completed tasks / total tasks × 100` for the selected event (ring + bar), plus a committee bar for officers.
- **Dashboard refresh** — event/task changes signal other tabs in the same browser; visible dashboards also refresh every 30 seconds to pick up changes made by other users.
- **Who & when tracker** — ticking a task writes `checked_by_*` on the task *and* a row in `task_logs`. Under the task you see: *Completed by John Doe (Logistics) on Nov 3, 2026, 4:33 PM*. Unticking clears that label and logs an "unchecked" entry (history is kept in **Recent Activity**). Double-clicks cannot create duplicate entries.
- **Notification bell** — officers see messages addressed to them; executives see the organization-wide feed. Notifications show read/unread status and can be marked individually or all at once.
- **Executive tools** — add/delete events (with optional end date), committees per event, tasks, and assign officers. The Members page manages the account roster and approval queue.

## Header, Settings page, Members and Membership Fee
- **Header (upper right):** search, Settings (gear), notifications (bell) and the profile button. *Switch Account* and *Log Out* are in the profile menu.
- Settings, Members, and Membership Fee keep a dashboard-style header and hamburger drawer; Dashboard is the drawer's first option.
- **Settings (gear)** opens `settings.html`: change name, Gmail, password, profile photo and dark / light mode.
- **Members** (hamburger menu) opens `members.html`: officer-submitted and sign-up account requests are visible to executives only and queued in creation order. Executives can approve or disapprove requests, add approved accounts immediately, change roles, and remove accounts.
- **Membership Fee** (hamburger menu) opens `payments.html`: officers can view, filter, and sort the student-body roster and status. Executives can rename sections, edit student records, mark students who dropped out as Dropped, and manage bulk imports. Only executives can see payment details and fund totals or record fees; each recorded receipt immediately counts as SOCCS funds. Student-body records do not create portal accounts.
- Membership Fee uses the `members` and `payments` tables. They are created automatically (with sample rows on first creation) when the backend starts. Membership fees use the existing dues defaults.

## Upgrading an existing database
Nothing to do: `backend/app.py` checks the database on start and adds anything missing
(`event_end_date`, `notifications.user_id`, `notification_reads`, audit columns, `task_logs`, unique/foreign keys).
`database/upgrade_existing_db.sql` contains the schema changes if you prefer to run them by hand.
Existing pending membership-fee entries are marked as received on the next backend start because only executives could record them under the previous workflow.

## MySQL port
XAMPP default is `3306`. If yours shows `3307`, edit `DB_PORT` in `backend/app.py`.
Set `SECRET_KEY` env var before deploying.
