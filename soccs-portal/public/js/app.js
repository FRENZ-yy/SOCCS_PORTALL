/* -- Utilities -------------------------------------------------------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
                'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const CIRC   = 2 * Math.PI * 42;
const TODAY  = new Date();

const state = {
  user: null, view: new Date(TODAY.getFullYear(), TODAY.getMonth(), 1),   // day 1 so month arrows never skip a month on the 29th-31st
  events: [],       // current-month events
  allEvents: [],    // ALL events across all months (for calendar rings)
  eventId: null, selectedDate: null, isExec: false, eventReadOnly: false
};

/* -- API helper ------------------------------------------------------------- */
async function api(url, method = 'GET', body, noRedirect = false) {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (r.status === 401 && !noRedirect) { location.replace('index.html'); throw new Error('auth'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || 'Something went wrong.');
  return data;
}

/* -- Today label ------------------------------------------------------------ */
function renderTodayLabel() {
  const label = `Today is ${DAYS[TODAY.getDay()]}, ${MONTHS[TODAY.getMonth()]} ${TODAY.getDate()}, ${TODAY.getFullYear()}`;
  const el = $('cardTodayDate');
  if (el) el.textContent = label;
}

/* -- Progress wheel --------------------------------------------------------- */
function setWheel(p) {
  $('pct').textContent = p + '%';
  $('ringfg').style.strokeDashoffset = CIRC * (1 - p / 100);
  $('eventRingPct').textContent = p + '%';
  $('eventRingFg').style.strokeDashoffset = CIRC * (1 - p / 100);
  $('eventRingWrap').setAttribute('aria-valuenow', p);
}

function setEventProgress(progress, done, total) {
  $('eventProgressBar').style.width = `${progress}%`;
  $('eventProgressBar').parentElement.setAttribute('aria-valuenow', progress);
  $('eventProgressText').textContent = `Task Progress: ${done} of ${total} complete`;
}

/* -- Calendar --------------------------------------------------------------- */
function buildEventDateMap(evArr) {
  const map = {};
  evArr.forEach(e => {
    const start = (e.event_date || '').slice(0, 10);
    const end   = (e.event_end_date || start).slice(0, 10);
    if (!start) return;
    let cur = new Date(start + 'T00:00:00');
    const endD = new Date(end + 'T00:00:00');
    while (cur <= endD) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(e);
      cur.setDate(cur.getDate() + 1);
    }
  });
  return map;
}

const pad2 = n => String(n).padStart(2, '0');
const ymd  = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** All events whose [start, end] range covers the given YYYY-MM-DD date. */
function eventsOn(dateStr) {
  return state.allEvents.filter(ev => {
    const start = (ev.event_date || '').slice(0, 10);
    const end   = (ev.event_end_date || start).slice(0, 10);
    return start && dateStr >= start && dateStr <= end;
  });
}

/** 'Nov 23, 2026'  or  'Nov 23 – Nov 25, 2026' (parsed by hand so timezones can't shift the day). */
function fmtRange(ev) {
  if (!ev) return '';
  const parse = str => { const [y, m, d] = str.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const f = (d, yr) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(yr ? { year: 'numeric' } : {}) });
  const s0 = parse(ev.event_date), e0 = parse(ev.event_end_date || ev.event_date);
  return s0.getTime() === e0.getTime() ? f(s0, true) : `${f(s0)} \u2013 ${f(e0, true)}`;
}

function isPastEvent(ev) {
  const endDate = (ev?.event_end_date || ev?.event_date || '').slice(0, 10);
  return Boolean(ev && (Number(ev.is_past) || Number(ev.is_completed) || (endDate && endDate < ymd(TODAY))));
}

function fmtEventLabel(ev) {
  if (!ev) return '';
  const [y,m,d] = ev.event_date.slice(0,10).split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const mon = dt.toLocaleDateString('en-US',{month:'short'}).toUpperCase();
  return `${mon} ${dt.getDate()} : ${ev.event_name}`;
}

function updateWelcome() {
  const firstName = (state.user.name || '').trim().split(/\s+/)[0] || 'Officer';
  const greeting = `Welcome, ${firstName}!`;
  $('welcomeTitle').textContent = greeting;

  const today = ymd(TODAY);
  const nextEvent = state.allEvents
    .filter(event => (event.event_end_date || event.event_date || '').slice(0, 10) >= today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id - b.id)[0];
  $('upcomingEventReminder').textContent = nextEvent ? fmtEventLabel(nextEvent) : 'No upcoming events.';
  const dateEl = $('cardTodayDate');
  if (dateEl && !dateEl.textContent) renderTodayLabel();
}



function renderCalendarGrid(gridId, monthLabelId) {
  const y = state.view.getFullYear(), m = state.view.getMonth();
  $(monthLabelId).textContent = `${MONTHS[m]} ${y}`;

  // Built from ALL events, so event days are ringed no matter which month you browse to
  const eventDateMap = buildEventDateMap(state.allEvents);
  const first = new Date(y, m, 1).getDay();
  const days  = new Date(y, m + 1, 0).getDate();
  const todayStr = ymd(TODAY);

  let html = '';
  for (let i = 0; i < first; i++) html += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const dateStr  = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const evList   = eventDateMap[dateStr] || [];
    const isToday  = dateStr === todayStr;                       // ring: today
    const hasEvent = evList.length > 0;                          // ring: any organization event
    const isGold   = evList.some(e => /fest|festival|gala|fair/i.test(e.event_name));
    const isPast   = hasEvent && evList.every(isPastEvent);
    const isSel    = evList.some(e => e.id === state.eventId);   // fill: the event being shown
    const isPicked = dateStr === state.selectedDate;             // outline: the exact day you tapped

    const cls = ['cal-day',
      hasEvent && (isGold ? 'event-gold' : 'event'),
      isPast   && 'event-past',
      isSel    && 'selected',
      isToday  && 'today',
      isPicked && 'picked'
    ].filter(Boolean).join(' ');

    const tip = [isToday ? 'Today' : '', ...evList.map(e => e.event_name), isPast ? 'Event ended - read only' : ''].filter(Boolean).join(' \u2022 ');
    html += `<button class="${cls}" data-date="${dateStr}"${tip ? ` title="${esc(tip)}"` : ''}`
          + ` aria-label="${esc(dateStr + (tip ? ': ' + tip : ''))}">${d}</button>`;
  }
  $(gridId).innerHTML = html;
}

function renderCalendar() {
  renderCalendarGrid('calGrid', 'monthLabel');
  renderCalendarGrid('eventCalGrid', 'eventMonthLabel');
}

/* Tap a date -> detect the event(s) on it -> filter tasks, committees and progress to that event */
async function selectCalendarDate(e) {
  const b = e.target.closest('[data-date]');
  if (!b) return;
  const dateStr = b.dataset.date;
  const evList  = eventsOn(dateStr);
  state.selectedDate = dateStr;

  if (!evList.length) { state.eventId = null; await refresh(); return; }       // no event that day
  if (evList.length === 1) {
    state.eventId = evList[0].id;
    await refresh();
    if (isPastEvent(evList[0])) await systemDialog.alert('This event is done and no longer available. Tasks are view-only.', 'Event no longer available');
    return;
  }

  // Several events share this day -> let the user choose which one to show
  if (b.closest('#eventCalGrid')) closeEventCard();
  openModal('Select Event', evList.map(ev => `
    <button class="btn text-sm py-[.6em] w-full text-left" data-pick="${ev.id}">
      ${esc(ev.event_name)}
      <span style="color:var(--mute);font-size:.85em"> &mdash; ${esc(fmtRange(ev))}</span>
    </button>`).join(''));
  $('modalBody').querySelectorAll('[data-pick]').forEach(btn => {
    btn.onclick = async () => {
      const event = evList.find(item => item.id === +btn.dataset.pick);
      state.eventId = +btn.dataset.pick;
      closeModal(); await refresh();
      if (isPastEvent(event)) await systemDialog.alert('This event is done and no longer available. Tasks are view-only.', 'Event no longer available');
    };
  });
}

$('calGrid').addEventListener('click', selectCalendarDate);
$('eventCalGrid').addEventListener('click', selectCalendarDate);
$('prev').onclick = $('eventPrev').onclick = () => { state.view.setMonth(state.view.getMonth() - 1); renderCalendar(); };
$('next').onclick = $('eventNext').onclick = () => { state.view.setMonth(state.view.getMonth() + 1); renderCalendar(); };

/* -- Format timestamp ------------------------------------------------------- */
function fmtTime(str) {
  if (!str) return '';
  const d = new Date(str.replace(' ', 'T'));
  if (isNaN(d)) return str;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/* -- Task rows + audit label ------------------------------------------------ */
/** "Completed by John Doe (Logistics) on Nov 3, 2026, 4:33 PM"  -- shown under every ticked task */
function auditLine(t) {
  if (!t.status) return '';
  if (!t.checked_by_name) return `<div class="task-audit">Completed <span style="opacity:.8">(before activity tracking was enabled)</span></div>`;
  const who = t.checked_by_label ? ` (${esc(t.checked_by_label)})` : '';
  return `<div class="task-audit">Completed by <strong>${esc(t.checked_by_name)}</strong>${who} on ${esc(fmtTime(t.checked_at))}</div>`;
}

const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>';

function taskRow(t) {
  return `
    <div class="task-wrap${t.status ? ' completed' : ''}${state.eventReadOnly ? ' event-readonly' : ''}">
      <div class="task-line">
        <label class="task ${t.status ? 'done' : ''}" data-id="${t.id}">
          <input type="checkbox" class="sr-only" ${t.status ? 'checked' : ''} ${state.eventReadOnly ? 'disabled' : ''}>
          <span class="box">${t.status ? '&#10003;' : ''}</span>
          <span class="t" title="${esc(t.task_name)}">${esc(t.task_name)}</span>
        </label>
        ${state.isExec && !state.eventReadOnly ? `<button type="button" class="task-edit" title="Manage tasks" aria-label="Manage tasks">${EDIT_ICON}</button>` : ''}
      </div>
      ${auditLine(t)}
    </div>`;
}

function orderTasks(tasks) {
  return [...tasks].sort((a, b) => Number(Boolean(a.status)) - Number(Boolean(b.status)));
}

function setCommitteeBar(done, total) {
  const p = pct(done, total);
  $('comBar').style.width = p + '%';
  $('comBar').parentElement.setAttribute('aria-valuenow', p);
  $('comBarText').textContent = `${done} / ${total} \u00b7 ${p}%`;
}
const pct = (done, total) => total ? Math.round(100 * done / total) : 0;

/* -- Officer view ----------------------------------------------------------- */
async function loadOfficer() {
  const d = await api('/api/dashboard' + (state.eventId ? `?eventId=${state.eventId}` : ''));
  if (d.event) state.eventId = d.event.id;
  state.eventReadOnly = isPastEvent(d.event);
  $('eventCaption').textContent = d.event ? fmtEventLabel(d.event) : 'No upcoming events';

  const com  = d.committee;
  const name = com ? com.committee_name : null;
  $('taskTitle').textContent   = name ? `${name} Committee Tasks`   : 'Your Committee Tasks';
  $('memberTitle').textContent = name ? `${name} Committee Members` : 'Your Committee Members';
  setWheel(d.progress);
  setEventProgress(d.progress, d.done, d.total);
  setCommitteeBar(d.committee_done || 0, d.committee_total || 0);

  if (d.tasks.length) {
    $('tasks').innerHTML = orderTasks(d.tasks).map(taskRow).join('');
  } else {
    $('tasks').innerHTML = `<p class="text-[.82em]" style="color:var(--mute)">${
      !d.event ? 'No event selected.'
      : d.committee ? 'No tasks assigned to your committee yet.'
      : 'You are not assigned to a committee for this event.'}</p>`;
  }

  $('members').innerHTML = d.members.length
    ? d.members.map(u => `
        <li class="truncate" title="${esc(u.email)}">
          ${esc(u.full_name)}<span style="color:var(--mute)"> &middot; ${esc(u.email)}</span>
        </li>`).join('')
    : `<li class="text-[.82em]" style="color:var(--mute)">No members yet.</li>`;

  // Chat
  _chatComId = com ? com.id : null;
  _chatComName = com ? com.committee_name : '';

  // Recent activity (audit trail) for this committee
  const actEl = $('activityFeed');
  actEl.innerHTML = d.activity && d.activity.length
    ? d.activity.map(a => `
        <div class="activity-item">
          <span class="activity-dot ${a.action === 'completed' ? 'done' : 'undo'}"></span>
          <div class="min-w-0">
            <span class="font-semibold">${esc(a.actor)}</span>${a.actor_label ? `<span style="color:var(--mute)"> (${esc(a.actor_label)})</span>` : ''}
            <span style="color:var(--mute)"> ${a.action === 'completed' ? 'checked' : 'unchecked'}</span>
            <span> &ldquo;${esc(a.task_name)}&rdquo;</span>
            <div class="text-[.72em]" style="color:var(--mute)">${esc(fmtTime(a.created_at))}</div>
          </div>
        </div>`).join('')
    : `<p class="text-[.78em]" style="color:var(--mute)">No activity yet.</p>`;
}

/* Tick / untick (officer's own committee list, or the executive board). Inputs lock while saving
   so a double-click can never create two log entries. */
async function onTaskChange(e) {
  const lbl = e.target.closest('.task');
  if (!lbl || state.eventReadOnly) return;
  document.querySelectorAll('.task input').forEach(i => i.disabled = true);
  try {
    await api(`/api/tasks/${lbl.dataset.id}`, 'PATCH', { status: e.target.checked });
    announceDashboardUpdate();
  }
  catch (x) { await systemDialog.alert(x.message, 'Task update failed'); }
  await (state.isExec ? loadExec() : loadOfficer());
}
$('tasks').addEventListener('change', onTaskChange);
$('execBoard').addEventListener('click', e => {
  if (e.target.closest('.task-edit')) document.querySelector('[data-act="addTask"]').click();
});
$('execBoard').addEventListener('change', onTaskChange);

/* -- Notification bell ------------------------------------------------------ */
async function loadNotifications() {
  const notes = await api('/api/notifications');
  if (!Array.isArray(notes)) throw new Error('The notifications response was invalid.');
  const list  = $('bellList');
  const markAllButton = $('markAllNotificationsRead');
  const hasUnread = notes.some(n => !Number(n.is_read));
  $('bellDot').classList.toggle('hidden', !hasUnread);
  markAllButton.hidden = !hasUnread;
  list.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'bell-item';
    empty.textContent = 'No notifications yet.';
    list.append(empty);
    return;
  }
  notes.forEach(n => {
    const isRead = Boolean(Number(n.is_read));
    const item = document.createElement('div');
    item.className = `bell-item${isRead ? '' : ' bell-item-new'}`;
    const message = document.createElement('p');
    message.className = 'bell-message';
    message.textContent = n.message;
    const status = document.createElement('span');
    status.className = `notification-state${isRead ? ' read' : ' unread'}`;
    status.textContent = isRead ? 'Read' : 'Unread';
    const time = document.createElement('span');
    time.className = 'bell-time';
    time.textContent = fmtTime(n.created_at);
    item.append(message, status, time);
    if (!isRead) {
      const readButton = document.createElement('button');
      readButton.type = 'button';
      readButton.className = 'notification-read-button';
      readButton.dataset.markNotification = n.id;
      readButton.textContent = 'Mark as read';
      item.append(readButton);
    }
    list.append(item);
  });
}

function showNotificationError(error) {
  console.error('Could not load notifications.', error);
  $('markAllNotificationsRead').hidden = true;
  const message = document.createElement('div');
  message.className = 'bell-item';
  message.setAttribute('role', 'status');
  message.textContent = 'Notifications could not be loaded. Check your connection and try again.';
  $('bellList').replaceChildren(message);
}

$('bellWrap').appendChild($('bellOverlay'));
$('bellList').addEventListener('click', async e => {
  const button = e.target.closest('[data-mark-notification]');
  if (!button) return;
  button.disabled = true;
  try {
    await api('/api/notifications/read', 'POST', { notification_id: button.dataset.markNotification });
    await loadNotifications();
  } catch (error) {
    button.disabled = false;
    showNotificationError(error);
  }
});
$('markAllNotificationsRead').addEventListener('click', async () => {
  try {
    await api('/api/notifications/read', 'POST', { all: true });
    await loadNotifications();
  } catch (error) {
    showNotificationError(error);
  }
});
$('bellBtn').addEventListener('click', async e => {
  e.stopPropagation();
  const overlay = $('bellOverlay');
  const isOpen  = !overlay.classList.contains('hidden');
  if (isOpen) {
    overlay.classList.add('hidden');
    $('bellBtn').setAttribute('aria-expanded', 'false');
    return;
  }
  try {
    await loadNotifications();
    if ($('dashboardHeader').parentElement === $('eventOverlay')) {
      const bellRect = $('bellBtn').getBoundingClientRect();
      overlay.classList.add('event-bell');
      overlay.style.top = `${bellRect.bottom + 8}px`;
      overlay.style.right = `${Math.max(12, innerWidth - bellRect.right)}px`;
    }
    overlay.classList.remove('hidden');
    $('bellBtn').setAttribute('aria-expanded', 'true');
  } catch (error) {
    showNotificationError(error);
    overlay.classList.remove('hidden');
    $('bellBtn').setAttribute('aria-expanded', 'true');
  }
});
$('bellClose').addEventListener('click', () => {
  $('bellOverlay').classList.add('hidden');
  $('bellBtn').setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', e => {
  const bo = $('bellOverlay');
  if (!bo.classList.contains('hidden') &&
      !bo.contains(e.target) && !$('bellBtn').contains(e.target)) {
    bo.classList.add('hidden');
    $('bellBtn').setAttribute('aria-expanded', 'false');
  }
});

/* -- Executive view --------------------------------------------------------- */
async function loadExec() {
  const b = await api('/api/exec/board' + (state.eventId ? `?eventId=${state.eventId}` : ''));
  if (b.event) state.eventId = b.event.id;
  state.eventReadOnly = isPastEvent(b.event);
  updateEventActionAvailability();
  $('eventCaption').textContent = b.event ? fmtEventLabel(b.event) : 'No events yet';

  setWheel(b.overall);
  setEventProgress(b.overall, b.done, b.total);
  $('overallBar').style.width = b.overall + '%';
  $('overallBar').parentElement.setAttribute('aria-valuenow', b.overall);
  $('overallText').textContent = b.event
    ? `Completions: ${b.done} of ${b.total}`
    : 'Create an event to get started.';
  $('overallPct').textContent = b.overall + '%';
  $('eventOverallBar').style.width = b.overall + '%';
  $('eventOverallBar').parentElement.setAttribute('aria-valuenow', b.overall);
  $('eventOverallText').textContent = $('overallText').textContent;
  $('eventOverallPct').textContent = $('overallPct').textContent;
  $('eventCardName').textContent = b.event ? b.event.event_name : '';
  $('eventCardDesc').textContent = b.event ? (b.event.description || '') : '';

  $('execBoard').innerHTML = !b.event
    ? `<p class="text-[.82em]" style="color:var(--mute)">No event selected.</p>`
    : b.committees.length
      ? b.committees.map(c => `
          <section class="com-block">
            <div class="flex items-center justify-between gap-2">
              <span class="title text-[.85em] truncate">${esc(c.name)}</span>
              <span class="text-[.75em] flex-none" style="color:var(--neon)">${c.percent}%
                <span style="color:var(--mute)">(${c.done}/${c.total})</span></span>
            </div>
            <div class="bar" style="height:.55em"><i style="width:${c.percent}%"></i></div>
            <p class="text-[.72em]" style="color:var(--mute)">${
              c.members.length ? 'Members: ' + c.members.map(esc).join(', ') : 'No members assigned yet'}</p>
            ${c.tasks.length ? orderTasks(c.tasks).map(taskRow).join('')
                             : '<p class="text-[.78em]" style="color:var(--mute)">No tasks yet.</p>'}
          </section>`).join('')
      : `<p class="text-[.82em]" style="color:var(--mute)">This event has no committees yet. Use <strong>Committees</strong> to add some.</p>`;
  // Keep the executive chat picker in sync with the current event.
  const execSel = $('chatCardComSel');
  const prevCid = execSel.value;
  execSel.innerHTML = b.committees.length
    ? b.committees.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    : '<option value="">No committees</option>';
  if (prevCid && [...execSel.options].some(o => o.value === prevCid)) execSel.value = prevCid;
}

/* -- Modal helpers ---------------------------------------------------------- */
function openModal(title, html, returnToEventCard = false) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML    = html;
  $('overlay').dataset.returnToEvent = returnToEventCard ? '1' : '';
  $('overlay').classList.add('open');
}
const closeModal = () => {
  const ret = $('overlay').dataset.returnToEvent === '1';
  $('overlay').classList.remove('open');
  $('overlay').dataset.returnToEvent = '';
  if (ret) openEventCard();
};
$('modalClose').onclick = closeModal;
$('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeDrawer();
    closeEventCard();
    closeCommitteeChat();
    closeSwitchAccountDialog();
    closeDeleteEventDialog();
    $('bellOverlay').classList.add('hidden');
    $('bellBtn').setAttribute('aria-expanded', 'false');
  }
});

const opts = (arr, v, l) => arr.map(o => `<option value="${o[v]}">${esc(o[l])}</option>`).join('');

function formModal(title, fields, url, method, after, returnToEventCard = false) {
  openModal(title, `
    <form id="mf" class="flex flex-col gap-[.8vh]">
      ${fields}
      <p id="mfMsg" role="status" class="min-h-[1.1em] text-[.78em] text-[#f87171]"></p>
      <button class="btn text-sm">Save</button>
    </form>`, returnToEventCard);
  $('mf').onsubmit = async e => {
    e.preventDefault();
    const msg = $('mfMsg'); msg.style.color = '';
    try {
      await api(url, method || 'POST', Object.fromEntries(new FormData(e.target)));
      announceDashboardUpdate();
      msg.style.color = 'var(--success)'; msg.textContent = 'Saved \u2713';
      e.target.reset(); await after();
    } catch (x) { msg.textContent = x.message; }
  };
}

/* -- Exec action buttons ---------------------------------------------------- */
document.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
  const wasEventCardOpen = $('eventOverlay').classList.contains('open');
  if (wasEventCardOpen) closeEventCard();
  const eidParam = state.eventId ? `?eventId=${state.eventId}` : '';
  const meta = await api('/api/exec/meta' + eidParam);
  const a = b.dataset.act;

  if (a === 'eventRecord') {
    const records = await api('/api/exec/event-records');
    const renderRecords = () => {
      $('modalBody').innerHTML = records.length
        ? `<div class="event-record-list">${records.map(event => `
            <article class="event-record-item">
              <div class="event-record-heading">
                <h3>${esc(event.event_name)}</h3>
                <span>${esc(fmtRange(event))}</span>
              </div>
              <p>${esc(event.description || 'No description provided.')}</p>
              <p class="event-record-task-count">Tasks: ${event.done} of ${event.total} complete</p>
              <div class="event-record-footer">
                <span class="event-record-status${event.is_completed ? ' done' : ''}">${event.is_completed ? 'Done' : 'Past event'}</span>
                <button class="btn${event.is_completed ? '' : ' success'}" type="button" data-complete-event="${event.id}"${event.is_completed ? ' disabled' : ''}>${event.is_completed ? 'Marked done' : 'Mark done'}</button>
              </div>
            </article>`).join('')}</div>`
        : '<p class="text-[.82em]" style="color:var(--mute)">No past events in the event record.</p>';

      $('modalBody').querySelectorAll('[data-complete-event]').forEach(button => {
        button.onclick = async () => {
          button.disabled = true;
          try {
            await api(`/api/exec/event-records/${button.dataset.completeEvent}/complete`, 'PATCH');
            const event = records.find(item => item.id === +button.dataset.completeEvent);
            if (event) event.is_completed = 1;
            announceDashboardUpdate();
            renderRecords();
            state.allEvents = await api('/api/events/all');
            renderCalendar();
            await refresh();
          } catch (error) {
            await systemDialog.alert(error.message, 'Could not mark event done');
            button.disabled = false;
          }
        };
      });
    };
    openModal('Event Record', '', wasEventCardOpen);
    renderRecords();
    return;
  }

  if (a === 'addEvent') {
    let editingEventId = null;
    const form = () => $('mf');
    const setEditingEvent = ev => {
      editingEventId = ev ? ev.id : null;
      form().elements.event_name.value = ev ? ev.title : '';
      form().elements.event_date.value = ev ? ev.date : '';
      form().elements.event_end_date.value = ev ? (ev.end_date || '') : '';
      form().elements.description.value = ev ? (ev.description || '') : '';
      $('eventFormSubmit').textContent = ev ? 'Save Changes' : '\uff0b Add Event';
      $('cancelEventEdit').hidden = !ev;
      $('mfMsg').textContent = '';
      form().elements.event_name.focus();
    };
    const renderEventList = async () => {
      const m2 = await api('/api/exec/meta');
      $('evList').innerHTML = m2.events.length
        ? m2.events.map(ev => `
            <div class="flex items-center justify-between gap-2 py-[.5vh] border-b" style="border-color:var(--line)">
              <span class="text-[.82em] truncate">${esc(ev.title)} <span style="color:var(--mute)">(${ev.date || ''}${ev.end_date ? ' \u2192 ' + ev.end_date : ''})</span></span>
              <button class="btn text-[.7em] px-2 py-[.2em] edit-ev flex-none" data-id="${ev.id}">Edit</button>
              <button class="btn danger text-[.7em] px-2 py-[.2em] del-ev flex-none" data-id="${ev.id}">Delete</button>
            </div>`).join('')
        : `<p class="text-[.82em]" style="color:var(--mute)">No events yet.</p>`;
      $('modalBody').querySelectorAll('.edit-ev').forEach(btn => {
        btn.onclick = () => {
          const ev = m2.events.find(item => item.id === +btn.dataset.id);
          if (ev) setEditingEvent(ev);
        };
      });
      $('modalBody').querySelectorAll('.del-ev').forEach(btn => {
        btn.onclick = () => {
          const evName = btn.closest('.flex')?.querySelector('span')?.textContent || 'this event';
          $('deleteEventMessage').textContent = `Delete "${evName.split(' (')[0]}" and all its committees and tasks?`;
          $('deleteEventError').hidden = true;
          $('deleteEventOverlay').classList.add('open');
          $('deleteEventOverlay').setAttribute('aria-hidden','false');
          $('deleteEventConfirm').onclick = async () => {
            $('deleteEventConfirm').disabled = true;
            $('deleteEventCancel').disabled = true;
            $('deleteEventError').hidden = true;
            try {
              await api(`/api/exec/events/${btn.dataset.id}`, 'DELETE');
              $('deleteEventOverlay').classList.remove('open');
              $('deleteEventOverlay').setAttribute('aria-hidden','true');
              $('deleteEventConfirm').disabled = false;
              $('deleteEventCancel').disabled = false;
              if (state.eventId === +btn.dataset.id) state.eventId = null;
              if (editingEventId === +btn.dataset.id) setEditingEvent(null);
              announceDashboardUpdate();
              await reloadEvents(); await renderEventList();
            } catch (x) {
              $('deleteEventError').textContent = x.message;
              $('deleteEventError').hidden = false;
              $('deleteEventConfirm').disabled = false;
              $('deleteEventCancel').disabled = false;
            }
          };
        };
      });
    };
    openModal('Manage Events', `
      <div id="evList" class="flex flex-col gap-[.3vh] mb-[1vh]"></div>
      <form id="mf" class="flex flex-col gap-[.8vh]">
        <input name="event_name" class="field text-sm" placeholder="Event name" required>
        <input name="description" class="field text-sm" placeholder="Short description (optional, max 100 chars)" maxlength="100">
        <label class="text-[.75em]" style="color:var(--mute)">Start Date
          <input name="event_date" type="date" class="field mt-[.3vh]" required>
        </label>
        <label class="text-[.75em]" style="color:var(--mute)">End Date <span style="font-weight:400">(optional)</span>
          <input name="event_end_date" type="date" class="field mt-[.3vh]">
        </label>
        <p id="mfMsg" role="status" class="min-h-[1.1em] text-[.78em] text-[#f87171]"></p>
        <div class="flex gap-2">
          <button id="eventFormSubmit" class="btn text-sm">\uff0b Add Event</button>
          <button id="cancelEventEdit" class="btn text-sm" type="button" hidden>Cancel edit</button>
        </div>
      </form>`, wasEventCardOpen);
    await renderEventList();
    $('cancelEventEdit').onclick = () => setEditingEvent(null);
    $('mf').onsubmit = async e => {
      e.preventDefault();
      const msg = $('mfMsg'); msg.style.color = '';
      try {
        const updating = editingEventId !== null;
        const path = updating ? `/api/exec/events/${editingEventId}` : '/api/exec/events';
        await api(path, updating ? 'PUT' : 'POST', Object.fromEntries(new FormData(e.target)));
        const successMessage = updating ? 'Event updated \u2713' : 'Event added \u2713';
        announceDashboardUpdate();
        e.target.reset();
        setEditingEvent(null);
        msg.style.color = 'var(--success)'; msg.textContent = successMessage;
        await reloadEvents(); await renderEventList();
      } catch (x) { msg.textContent = x.message; }
    };
  }

  if (a === 'manageCommittees') {
    const renderComs = async () => {
      const m2 = await api('/api/exec/meta' + eidParam);
      const evOpts = m2.events.map(ev =>
        `<option value="${ev.id}" ${ev.id === state.eventId ? 'selected' : ''}>${esc(ev.title)}</option>`
      ).join('');
      $('modalBody').innerHTML = `
        <div id="comList" class="flex flex-col gap-[.2vh] mb-[1vh]">${
          m2.committees.length
            ? m2.committees.map(c => `
                <div class="flex items-center justify-between gap-2 py-[.5vh] border-b" style="border-color:var(--line)">
                  <span class="text-[.82em] truncate">${esc(c.name)}</span>
                  <button class="btn danger text-[.7em] px-2 py-[.2em] del-com flex-none" data-id="${c.id}">Delete</button>
                </div>`).join('')
            : `<p class="text-[.82em]" style="color:var(--mute)">No committees yet.</p>`
        }</div>
        <form id="addComForm" class="flex flex-col gap-[.8vh]">
          <input name="committee_name" class="field text-sm" placeholder="New committee name" required>
          <select name="event_id" class="field text-sm">${evOpts}</select>
          <p id="comMsg" class="text-[.78em] text-[#f87171] min-h-[1.1em]"></p>
          <button class="btn text-sm">\uff0b Add Committee</button>
        </form>`;
      $('addComForm').onsubmit = async ev => {
        ev.preventDefault();
        const msg = $('comMsg'); msg.style.color = '';
        try {
          await api('/api/exec/committees', 'POST', Object.fromEntries(new FormData(ev.target)));
          announceDashboardUpdate();
          msg.style.color = 'var(--success)'; msg.textContent = 'Committee added \u2713';
          ev.target.reset(); await renderComs(); await refresh();
        } catch (x) { msg.textContent = x.message; }
      };
      $('modalBody').querySelectorAll('.del-com').forEach(btn => {
        btn.onclick = async () => {
          if (!await systemDialog.confirm('Delete this committee and all its tasks?', { title: 'Delete committee', confirmText: 'Delete', danger: true })) return;
          try { await api(`/api/exec/committees/${btn.dataset.id}`, 'DELETE'); announceDashboardUpdate(); await renderComs(); await refresh(); }
          catch (x) { await systemDialog.alert(x.message, 'Could not delete committee'); }
        };
      });
    };
    openModal('Manage Committees', '', wasEventCardOpen); await renderComs();
  }

  if (a === 'addTask') {
    const renderTaskList = async () => {
      const m2 = await api('/api/exec/meta' + eidParam);
      if (!m2.committees.length) {
        $('taskListWrap').innerHTML = `<p class="text-[.82em]" style="color:var(--mute)">No committees yet.</p>`;
        return;
      }
      const rows = await api('/api/exec/tasks' + eidParam);
      $('taskListWrap').innerHTML = rows.length
        ? rows.map(t => `
            <div class="flex items-center justify-between gap-2 py-[.4vh] border-b" style="border-color:var(--line)">
              <span class="text-[.78em] truncate">${esc(t.task_name)} <span style="color:var(--mute)">[${esc(t.committee_name)}]</span></span>
              <button class="btn danger text-[.7em] px-2 py-[.2em] del-task flex-none" data-id="${t.id}">\u2715</button>
            </div>`).join('')
        : `<p class="text-[.82em]" style="color:var(--mute)">No tasks yet.</p>`;
      $('modalBody').querySelectorAll('.del-task').forEach(btn => {
        btn.onclick = async () => {
          try { await api(`/api/exec/tasks/${btn.dataset.id}`, 'DELETE'); announceDashboardUpdate(); await renderTaskList(); await refresh(); }
          catch (x) { await systemDialog.alert(x.message, 'Could not delete task'); }
        };
      });
      $('taskComSel').innerHTML = opts(m2.committees, 'id', 'name');
    };
    openModal('Manage Tasks', `
      <div id="taskListWrap" class="flex flex-col gap-[.2vh] mb-[1vh] max-h-[20vh] overflow-y-auto pr-1"></div>
      <form id="mf" class="flex flex-col gap-[.8vh]">
        <select id="taskComSel" name="committee_id" class="field text-sm"></select>
        <input name="task_name" class="field text-sm" placeholder="Task description" required>
        <p id="mfMsg" role="status" class="min-h-[1.1em] text-[.78em] text-[#f87171]"></p>
        <button class="btn text-sm">\uff0b Add Task</button>
      </form>`, wasEventCardOpen);
    await renderTaskList();
    $('mf').onsubmit = async e => {
      e.preventDefault();
      const msg = $('mfMsg'); msg.style.color = '';
      try {
        await api('/api/exec/tasks', 'POST', Object.fromEntries(new FormData(e.target)));
        announceDashboardUpdate();
        msg.style.color = 'var(--success)'; msg.textContent = 'Task added \u2713';
        e.target.reset(); await renderTaskList(); await refresh();
      } catch (x) { msg.textContent = x.message; }
    };
  }

  if (a === 'assign') {
    if (!meta.users.length || !meta.committees.length) {
      openModal('Assign Officer to Committee', `
        <p class="text-[.82em]" style="color:var(--mute)">${
          !meta.committees.length ? 'Add a committee for this event before assigning an officer.' : 'No approved officers are available to assign.'
        }</p>`, wasEventCardOpen);
    } else {
      const assignMap = {};
      (meta.assignments || []).forEach(a => { assignMap[a.user_id] = a.committee_id; });
      const comName = id => { const c = meta.committees.find(c => c.id === id); return c ? c.name : ''; };
      const userOpts = meta.users.map(u => {
        const cid = assignMap[u.id];
        const label = cid ? `${esc(u.full_name)} (already in ${esc(comName(cid))})` : esc(u.full_name);
        return `<option value="${u.id}"${cid ? ' data-assigned="1"' : ''}>${label}</option>`;
      }).join('');
      formModal('Assign Officer to Committee',
        `<label class="text-[.75em]" style="color:var(--mute)">Officer
           <select name="user_id" class="field text-sm mt-[.3vh]" required>
             <option value="">Choose an officer</option>${userOpts}
           </select>
         </label>
         <label class="text-[.75em]" style="color:var(--mute)">Committee
           <select name="committee_id" class="field text-sm mt-[.3vh]" required>
             <option value="">Choose a committee</option>${opts(meta.committees, 'id', 'name')}
           </select>
         </label>`,
        '/api/exec/assign', 'POST', refresh, wasEventCardOpen);
    }
  }
});

/* -- Breakdown modal -------------------------------------------------------- */
$('breakdownBtn').onclick = async () => {
  const p = await api('/api/exec/progress' + (state.eventId ? `?eventId=${state.eventId}` : ''));
  openModal('Committee Progress Breakdown',
    p.committees.length
      ? p.committees.map(c => `
          <div>
            <div class="flex justify-between text-[.82em] mb-[.3vh]">
              <span>${esc(c.name)}</span>
              <span style="color:var(--neon)">${c.percent}% <span style="color:var(--mute)">(${c.done}/${c.total})</span></span>
            </div>
            <div class="bar"><i style="width:${c.percent}%"></i></div>
          </div>`).join('')
      : '<p class="text-[.82em]" style="color:var(--mute)">No committee data yet.</p>');
};
$('eventBreakdownBtn').onclick = () => $('breakdownBtn').click();

/* -- Drawer ----------------------------------------------------------------- */
function openDrawer()  { $('drawer').classList.add('open');    $('drawerScrim').classList.add('open'); }
function closeDrawer() { $('drawer').classList.remove('open'); $('drawerScrim').classList.remove('open'); }
function updateEventActionAvailability() {
  document.querySelectorAll('#eventOverlay [data-act="addTask"], #eventOverlay [data-act="assign"], #eventOverlay [data-act="manageCommittees"]')
    .forEach(button => { button.disabled = state.eventReadOnly; });
}
function openEventCard() {
  renderCalendar();
  updateEventActionAvailability();
  $('eventOverlay').insertBefore($('dashboardHeader'), $('eventPageContent'));
  $('eventOverlay').insertBefore($('bellOverlay'), $('eventPageContent'));
  $('eventOverlay').insertBefore($('overlay'), $('eventPageContent'));
  $('eventOverlay').insertBefore($('switchAccountOverlay'), $('eventPageContent'));
  $('eventOverlay').insertBefore($('deleteEventOverlay'), $('eventPageContent'));
  $('eventOverlay').classList.add('open');
  $('eventOverlay').setAttribute('aria-hidden', 'false');
}
function closeEventCard() {
  $('eventOverlay').classList.remove('open');
  $('eventOverlay').setAttribute('aria-hidden', 'true');
  $('bellOverlay').classList.add('hidden');
  $('bellBtn').setAttribute('aria-expanded', 'false');
  $('bellOverlay').classList.remove('event-bell');
  $('bellOverlay').style.removeProperty('top');
  $('bellOverlay').style.removeProperty('right');
  $('dashboardHeaderMount').before($('dashboardHeader'));
  $('bellOverlayMount').before($('bellOverlay'));
  $('overlayMount').before($('overlay'));
  $('switchAccountMount').before($('switchAccountOverlay'));
  $('deleteEventMount').before($('deleteEventOverlay'));
}

$('drawerBtn').onclick   = () => openSettingsDrawer();   // hamburger menu
$('drawerClose').onclick = closeDrawer;
$('drawerScrim').onclick = closeDrawer;
$('eventCardClose').onclick = closeEventCard;
$('eventOverlay').addEventListener('click', e => {
  if (e.target === $('eventOverlay')) closeEventCard();
});
$('chatCardClose').onclick = closeCommitteeChat;
$('chatOverlay').addEventListener('click', e => {
  if (e.target === $('chatOverlay')) closeCommitteeChat();
});

/* -- Settings Drawer -------------------------------------------------------- */
function openSettingsDrawer() {
  $('eventMenuItem').hidden = !state.isExec;
  openDrawer();
}

document.getElementById('settingsMenu').addEventListener('click', async e => {
  const btn = e.target.closest('[data-settings]');
  if (!btn) return;
  const act = btn.dataset.settings;
  closeDrawer();

  if (act === 'payments') {
    // Keep the dashboard open while showing Membership Fee separately.
    const w = window.open('payments.html', '_blank');
    if (w) w.focus();
    return;
  }

  if (act === 'members') {
    const w = window.open('members.html', '_blank');
    if (w) w.focus();
    return;
  }

  if (act === 'settings') {
    const w = window.open('settings.html', '_blank');
    if (w) w.focus();
    return;
  }

  if (act === 'chat') {
    await openCommitteeChat();
    return;
  }

  if (act === 'event') {
    if (state.isExec) openEventCard();
    return;
  }

  if (act === 'addMember') {
    const meta = await api('/api/exec/meta' + (state.eventId ? `?eventId=${state.eventId}` : ''));
    openModal('Add Member', `
      <form id="mf" class="flex flex-col gap-[.8vh]">
        <label class="text-[.75em]" style="color:var(--mute)">FULL NAME
          <input name="full_name" class="field text-sm mt-[.3vh]" placeholder="e.g. Maria Santos" pattern="[A-Za-z]+(?: [A-Za-z]+)*" title="Use letters only, with spaces between names." required>
        </label>
        <label class="text-[.75em]" style="color:var(--mute)">EMAIL ADDRESS
          <input name="email" type="email" class="field text-sm mt-[.3vh]" placeholder="member@soccs.edu" required>
        </label>
        <label class="text-[.75em]" style="color:var(--mute)">TEMPORARY PASSWORD
          <input name="password" type="password" class="field text-sm mt-[.3vh]" placeholder="8+ characters" minlength="8" required>
        </label>
        <label class="text-[.75em]" style="color:var(--mute)">ROLE
          <select name="role" class="field text-sm mt-[.3vh]">
            <option value="Regular Officer">Regular Officer</option>
            <option value="Executive">Executive</option>
          </select>
        </label>
        <label class="text-[.75em]" style="color:var(--mute)">ASSIGN TO COMMITTEE (optional)
          <select name="committee_id" class="field text-sm mt-[.3vh]">
            <option value="">&mdash; None &mdash;</option>
            ${opts(meta.committees, 'id', 'name')}
          </select>
        </label>
        <p id="mfMsg" role="status" class="min-h-[1.1em] text-[.78em] text-[#f87171]"></p>
        <button class="btn text-sm">Save Member</button>
      </form>`);
    $('mf').onsubmit = async e => {
      e.preventDefault();
      const msg = $('mfMsg'); msg.style.color = '';
      try {
        await api('/api/exec/users', 'POST', Object.fromEntries(new FormData(e.target)));
        msg.style.color = 'var(--success)'; msg.textContent = 'Member account added and ready to use \u2713';
        e.target.reset();
      } catch (x) { msg.textContent = x.message; }
    };
  }

  if (act === 'manageMembers') {
    const renderMembers = async () => {
      const members = await api('/api/exec/members');
      const myId = state.user.id;
      $('modalBody').innerHTML = members.length
        ? `<div class="flex flex-col gap-[.3vh]">${members.map(u => `
            <div class="flex items-center justify-between gap-2 py-[.5vh] border-b" style="border-color:var(--line)">
              <div class="min-w-0">
                <p class="text-[.82em] truncate font-semibold">${esc(u.full_name)}</p>
                <p class="text-[.72em] truncate" style="color:var(--mute)">${esc(u.email)} &middot; <span class="${u.role === 'Executive' ? 'badge badge-exec' : 'badge badge-officer'}" style="font-size:.9em">${esc(u.role)}</span></p>
              </div>
              ${u.id === myId ? '<span class="text-[.7em]" style="color:var(--mute)">(you)</span>' : `
              <div class="flex gap-1 flex-none">
                <button class="btn text-[.65em] px-2 py-[.2em] role-btn" data-id="${u.id}" data-role="${u.role === 'Executive' ? 'Regular Officer' : 'Executive'}">
                  ${u.role === 'Executive' ? 'Make Officer' : 'Make Exec'}
                </button>
                <button class="btn danger text-[.65em] px-2 py-[.2em] del-user" data-id="${u.id}" data-name="${esc(u.full_name)}">Remove</button>
              </div>`}
            </div>`).join('')}</div>`
        : `<p class="text-[.82em]" style="color:var(--mute)">No members found.</p>`;
      $('modalBody').querySelectorAll('.role-btn').forEach(btn => {
        btn.onclick = async () => {
          if (!await systemDialog.confirm(`Change role to "${btn.dataset.role}"?`, { title: 'Change member role', confirmText: 'Change role' })) return;
          btn.disabled = true; btn.textContent = '...';
          try { await api(`/api/exec/users/${btn.dataset.id}/role`, 'PATCH', { role: btn.dataset.role }); await renderMembers(); }
          catch (x) { await systemDialog.alert(x.message, 'Could not change role'); btn.disabled = false; }
        };
      });
      $('modalBody').querySelectorAll('.del-user').forEach(btn => {
        btn.onclick = async () => {
          if (!await systemDialog.confirm(`Remove "${btn.dataset.name}"? This cannot be undone.`, { title: 'Remove account', confirmText: 'Remove', danger: true })) return;
          btn.disabled = true; btn.textContent = '...';
          try { await api(`/api/exec/users/${btn.dataset.id}`, 'DELETE'); await renderMembers(); }
          catch (x) { await systemDialog.alert(x.message, 'Could not remove account'); btn.disabled = false; }
        };
      });
    };
    openModal('Manage Members', ''); await renderMembers();
  }

  if (act === 'approveAccounts') {
    const renderPending = async () => {
      const m2 = await api('/api/exec/meta');
      $('modalBody').innerHTML = `<div class="flex flex-col gap-[.2vh]">${
        m2.pending.length
          ? m2.pending.map(u => `
              <div class="flex items-center justify-between gap-2 py-[.5vh] border-b" style="border-color:var(--line)">
                <div class="min-w-0">
                  <p class="text-[.82em] truncate font-semibold">${esc(u.full_name)}</p>
                  <p class="text-[.72em] truncate" style="color:var(--mute)">${esc(u.email)} &middot; ${esc(u.role)}</p>
                </div>
                <button class="btn success text-[.7em] px-2 py-[.2em] approve-btn flex-none" data-id="${u.id}">Approve</button>
              </div>`).join('')
          : `<p class="text-[.82em]" style="color:var(--mute)">No pending accounts.</p>`
      }</div>`;
      $('modalBody').querySelectorAll('.approve-btn').forEach(btn => {
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = '...';
          try { await api(`/api/admin/approve/${btn.dataset.id}`, 'POST'); await renderPending(); }
          catch (x) { await systemDialog.alert(x.message, 'Could not approve account'); btn.disabled = false; btn.textContent = 'Approve'; }
        };
      });
    };
    openModal('Approve Account Requests', ''); await renderPending();
  }
});

/* -- Chat ------------------------------------------------------------------- */
let _chatComId = null;
let _chatComName = '';

function renderChatMsg(m, myId) {
  const mine = m.sender_name === state.user.name;
  const initials = (m.sender_name || '?')[0].toUpperCase();
  const avatarHtml = m.avatar
    ? `<div class="chat-avatar" style="background-image:url('${m.avatar}');background-size:cover;background-position:center"></div>`
    : `<div class="chat-avatar">${initials}</div>`;
  return `
    <div class="chat-msg ${mine ? 'chat-mine' : 'chat-theirs'}">
      ${!mine ? avatarHtml : ''}
      <div class="chat-bubble">
        ${!mine ? `<span class="chat-sender">${esc(m.sender_name)}<span class="chat-role ${m.sender_role === 'Executive' ? 'badge-exec' : 'badge-officer'}">${esc(m.sender_role === 'Executive' ? 'Exec' : 'Officer')}</span></span>` : ''}
        <span>${esc(m.message)}</span>
      </div>
      ${mine ? avatarHtml : ''}
    </div>`;
}

async function loadChat(committeeId, feedEl) {
  if (!committeeId) { feedEl.innerHTML = '<p class="text-[.75em]" style="color:var(--mute)">No committee selected.</p>'; return; }
  try {
    const msgs = await api(`/api/chat/${committeeId}`);
    feedEl.innerHTML = msgs.length
      ? msgs.map(m => renderChatMsg(m)).join('')
      : '<p class="text-[.75em]" style="color:var(--mute)">No messages yet. Say hi!</p>';
    feedEl.scrollTop = feedEl.scrollHeight;
  } catch { feedEl.innerHTML = '<p class="text-[.75em]" style="color:var(--mute)">Chat unavailable.</p>'; }
}

async function loadChatMembers(committeeId) {
  const list = $('chatMembersList');
  if (!list) return;
  if (!committeeId) { list.innerHTML = '<li style="color:var(--mute)">No committee selected.</li>'; return; }
  try {
    const data = await api('/api/committees/' + committeeId + '/members');
    const members = Array.isArray(data) ? data : (data.members || []);
    list.innerHTML = members.length
      ? members.map(m => '<li>' + esc(m.name || m.full_name || m) + '</li>').join('')
      : '<li style="color:var(--mute)">No members assigned yet.</li>';
  } catch { list.innerHTML = '<li style="color:var(--mute)">Could not load members.</li>'; }
}

function selectedChatCommitteeId() {
  return state.isExec ? (+$('chatCardComSel').value || null) : _chatComId;
}

function updateChatCardHeader() {
  const cid = selectedChatCommitteeId();
  const input = $('chatCardInput');
  const select = $('chatCardComSel');
  const selectedName = select.selectedOptions[0]?.textContent || '';
  $('chatCardSubtitle').textContent = state.isExec
    ? (selectedName || 'No committees available')
    : (_chatComName || 'No committee assigned');
  input.placeholder = state.isExec ? 'Message as executive…' : `Message ${_chatComName || 'your committee'}…`;
  input.disabled = !cid;
  return cid;
}

async function openCommitteeChat() {
  const picker = $('chatCommitteePickerWrap');
  picker.hidden = !state.isExec;
  $('chatMembersPanel').hidden = true;
  $('chatCardFeed').hidden = false;
  const committeeId = updateChatCardHeader();
  $('chatOverlay').classList.add('open');
  $('chatOverlay').setAttribute('aria-hidden', 'false');
  await loadChat(committeeId, $('chatCardFeed'));
  if (committeeId) $('chatCardInput').focus();
}

function closeCommitteeChat() {
  $('chatOverlay').classList.remove('open');
  $('chatOverlay').setAttribute('aria-hidden', 'true');
}

$('chatMembersToggle').addEventListener('click', async () => {
  const panel = $('chatMembersPanel');
  const feed  = $('chatCardFeed');
  const open  = panel.hidden;
  panel.hidden = !open;
  feed.hidden  = open;
  if (open) await loadChatMembers(selectedChatCommitteeId());
});

$('chatCardComSel').addEventListener('change', async () => {
  const committeeId = updateChatCardHeader();
  await loadChat(committeeId, $('chatCardFeed'));
  if (!$('chatMembersPanel').hidden) await loadChatMembers(committeeId);
});

$('chatCardForm').addEventListener('submit', async e => {
  e.preventDefault();
  const committeeId = selectedChatCommitteeId();
  const input = $('chatCardInput');
  const message = input.value.trim();
  if (!message || !committeeId) return;
  input.value = '';
  input.disabled = true;
  try {
    await api(`/api/chat/${committeeId}`, 'POST', { message });
    await loadChat(committeeId, $('chatCardFeed'));
  } catch (x) {
    await systemDialog.alert(x.message, 'Could not send message');
  } finally {
    input.disabled = !selectedChatCommitteeId();
    input.focus();
  }
});

/* -- Boot ------------------------------------------------------------------- */
function showNoEventState() {
  state.eventReadOnly = false;
  updateEventActionAvailability();
  const label = state.selectedDate
    ? fmtRange({ event_date: state.selectedDate, event_end_date: state.selectedDate })
    : 'the selected date';
  $('eventCaption').textContent = `No event on ${label}`;
  setWheel(0);
  setEventProgress(0, 0, 0);
  if (state.isExec) {
    $('overallBar').style.width = '0%';
    $('overallText').textContent = 'No event on the selected date';
    $('overallPct').textContent = '0%';
    $('eventOverallBar').style.width = '0%';
    $('eventOverallBar').parentElement.setAttribute('aria-valuenow', 0);
    $('eventOverallText').textContent = $('overallText').textContent;
    $('eventOverallPct').textContent = '0%';
    $('execBoard').innerHTML = `<p class="text-[.82em]" style="color:var(--mute)">No event on ${esc(label)}. Pick a ringed date, or add an event.</p>`;
  } else {
    $('taskTitle').textContent = 'Committee Tasks';
    setCommitteeBar(0, 0);
    $('tasks').innerHTML = `<p class="text-[.82em]" style="color:var(--mute)">No event on ${esc(label)}. Pick a ringed date to see its tasks.</p>`;
    $('memberTitle').textContent = 'Committee Members';
    $('members').innerHTML = '';
    $('activityFeed').innerHTML = '';
  }
}

/** One function keeps calendar, progress, committees and tasks in sync with the selected date. */
async function refresh() {
  const dateEvents = state.selectedDate ? eventsOn(state.selectedDate) : [];
  if (state.selectedDate && !dateEvents.length) {
    state.eventId = null;
    state.eventReadOnly = false;
    showNoEventState();
    renderCalendar();
    return;
  }
  // keep the shown event consistent with the tapped date (e.g. an event was just added on it)
  if (dateEvents.length && !dateEvents.some(ev => ev.id === state.eventId)) state.eventId = dateEvents[0].id;
  await (state.isExec ? loadExec() : loadOfficer());
  renderCalendar();
  runSearch();
}

/** Re-fetch events after one is added/deleted, then redraw everything. */
async function reloadEvents() {
  state.allEvents = await api('/api/events/all');
  updateWelcome();
  await refresh();
}

function announceDashboardUpdate() {
  try {
    localStorage.setItem('soccs-dashboard-updated', String(Date.now()));
  } catch (error) {
    console.error('Could not notify other dashboard tabs about the update.', error);
  }
}

let dashboardSyncRunning = false;
let lastDashboardSyncAt = 0;
async function syncDashboardData() {
  if (dashboardSyncRunning) return;
  dashboardSyncRunning = true;
  try {
    state.allEvents = await api('/api/events/all');
    updateWelcome();
    await refresh();
    lastDashboardSyncAt = Date.now();
  } catch (error) {
    console.error('Could not refresh dashboard data.', error);
  } finally {
    dashboardSyncRunning = false;
  }
}

window.addEventListener('storage', event => {
  if (event.key === 'soccs-dashboard-updated') syncDashboardData();
});
window.addEventListener('focus', () => {
  if (Date.now() - lastDashboardSyncAt >= 30000) syncDashboardData();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastDashboardSyncAt >= 30000) {
    syncDashboardData();
  }
});
window.setInterval(() => {
  if (document.visibilityState === 'visible') syncDashboardData();
}, 30000);

$('logout').onclick = async () => { await api('/api/auth/logout', 'POST'); location.replace('index.html'); };

/* -- Profile menu (Switch Account / Log Out) ------------------------------- */
function setProfileMenu(open) {
  $('profileMenu').classList.toggle('hidden', !open);
  $('profileBtn').setAttribute('aria-expanded', String(open));
}
$('profileBtn').addEventListener('click', e => {
  e.stopPropagation();
  setProfileMenu($('profileMenu').classList.contains('hidden'));
});
document.addEventListener('click', e => { if (!$('profileMenu').contains(e.target)) setProfileMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setProfileMenu(false); });
function openSwitchAccountDialog() {
  $('switchAccountError').hidden = true;
  $('switchAccountError').textContent = '';
  $('switchAccountOverlay').classList.add('open');
  $('switchAccountOverlay').setAttribute('aria-hidden', 'false');
  $('switchAccountCancel').focus();
}
function closeSwitchAccountDialog() {
  $('switchAccountOverlay').classList.remove('open');
  $('switchAccountOverlay').setAttribute('aria-hidden', 'true');
}
$('switchAccountBtn').onclick = () => {
  setProfileMenu(false);
  openSwitchAccountDialog();
};
$('switchAccountClose').onclick = closeSwitchAccountDialog;
$('switchAccountCancel').onclick = closeSwitchAccountDialog;
$('switchAccountOverlay').addEventListener('click', e => {
  if (e.target === $('switchAccountOverlay')) closeSwitchAccountDialog();
});
function closeDeleteEventDialog() {
  $('deleteEventOverlay').classList.remove('open');
  $('deleteEventOverlay').setAttribute('aria-hidden','true');
}
$('deleteEventClose').onclick = closeDeleteEventDialog;
$('deleteEventCancel').onclick = closeDeleteEventDialog;
$('deleteEventOverlay').addEventListener('click', e => {
  if (e.target === $('deleteEventOverlay')) closeDeleteEventDialog();
});
$('switchAccountConfirm').onclick = async () => {
  const confirmButton = $('switchAccountConfirm');
  const cancelButton = $('switchAccountCancel');
  const errorMessage = $('switchAccountError');
  confirmButton.disabled = true;
  cancelButton.disabled = true;
  errorMessage.hidden = true;
  try {
    await api('/api/auth/logout', 'POST');
    location.replace('index.html');
  } catch (error) {
    errorMessage.textContent = error.message || 'Could not switch accounts. Please try again.';
    errorMessage.hidden = false;
  } finally {
    confirmButton.disabled = false;
    cancelButton.disabled = false;
  }
};

/* -- Header search ---------------------------------------------------------
   Typing filters the visible tasks / committees. Enter jumps the calendar to the
   first event whose name matches. */
function runSearch() {
  const q = $('headerSearch').value.trim().toLowerCase();
  document.querySelectorAll('#tasks .task-wrap, #execBoard .task-wrap').forEach(el => {
    el.style.display = !q || el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  document.querySelectorAll('#execBoard .com-block').forEach(block => {
    const hit = !q || block.textContent.toLowerCase().includes(q);
    block.style.display = hit ? '' : 'none';
  });
}
$('headerSearch').addEventListener('input', runSearch);
$('headerSearch').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const q = $('headerSearch').value.trim().toLowerCase();
  if (!q) return;
  const ev = state.allEvents.find(x => x.event_name.toLowerCase().includes(q));
  if (!ev) return;
  const start = ev.event_date.slice(0, 10);
  const [y, m] = start.split('-').map(Number);
  state.view = new Date(y, m - 1, 1);
  state.selectedDate = start; state.eventId = ev.id;
  await refresh(); runSearch();
});

(async () => {
  let meResp;
  try { meResp = await api('/api/auth/me', 'GET', undefined, true); }
  catch (e) { location.replace('index.html'); return; }

  state.user   = meResp;
  state.isExec = state.user.role === 'Executive';

  if (localStorage.getItem('soccs-theme') === 'light') document.body.classList.add('light-mode');

  renderTodayLabel();
  $('who').textContent = state.user.name;
  $('profileDisplayName').textContent = state.user.name;
  if (state.user.avatar) {
    $('headerAvatar').style.backgroundImage = `url('${state.user.avatar}')`;
    $('headerAvatar').classList.add('photo');
  }

  const badge = $('roleBadge');
  badge.textContent = state.user.role;
  badge.className   = 'badge ' + (state.isExec ? 'badge-exec' : 'badge-officer');
  badge.classList.remove('hidden');

  $('brand').textContent = state.isExec ? 'EXECUTIVE DASHBOARD' : 'SOCCS PORTAL';
  if (state.isExec) document.body.classList.add('exec-bg');

  $(state.isExec ? 'execView' : 'officerView').classList.remove('hidden');
  document.body.classList.add('ready');

  $('bellWrap').classList.remove('hidden');
  try {
    await loadNotifications();
  } catch (error) {
    showNotificationError(error);
  }

  // Load ALL events once so the calendar can ring event days in every month
  state.allEvents = await api('/api/events/all');
  lastDashboardSyncAt = Date.now();
  updateWelcome();

  // Open on today's event if there is one; otherwise the backend picks the next upcoming event
  const todays = eventsOn(ymd(TODAY));
  if (todays.length && state.isExec) { state.selectedDate = ymd(TODAY); state.eventId = todays[0].id; }

  await refresh();
  const requestedView = new URLSearchParams(location.search).get('open');
  if (requestedView === 'event' && state.isExec) openEventCard();
  if (requestedView === 'chat') await openCommitteeChat();
  document.body.classList.add('ready');
})();
