// Redirect if already logged in
fetch('/api/auth/me').then(r => { if (r.ok) location.replace('dashboard.html'); });

/* ── Landing modal content ─────────────────────────────────────────────────── */
const MODAL_CONTENT = {
  about: {
    title: 'About SOCCS',
    body: `
      <div class="fm-form" style="gap:14px">
        <p>The <strong>Student Organization of the College of Computer Studies (SOCCS)</strong>
        represents computer science and information technology students.</p>
        <p>The portal brings event planning, committee coordination, and task tracking together.</p>
        <div class="fm-note">
          <p style="margin:0 0 4px;font-weight:700;color:#f0d0ff">Our Mission</p>
          <p style="margin:0">To foster academic excellence, career growth, and community through organized events and teamwork.</p>
        </div>
      </div>`
  },
  features: {
    title: 'Portal Features',
    body: `
      <ul class="fm-list">
        <li><span class="fm-dot"></span><span><b>Live Calendar</b> &mdash; View events and their tasks by date.</span></li>
        <li><span class="fm-dot"></span><span><b>Committee Tasks</b> &mdash; Track shared checklists and event progress.</span></li>
        <li><span class="fm-dot"></span><span><b>Dynamic Rosters</b> &mdash; Executives can create committees and reassign officers.</span></li>
        <li><span class="fm-dot"></span><span><b>Notifications</b> &mdash; Get updates about events, tasks, and assignments.</span></li>
        <li><span class="fm-dot"></span><span><b>Role-Based Access</b> &mdash; Executive and officer dashboards provide the right tools.</span></li>
      </ul>`
  },
  contact: {
    title: 'We\u2019d love to hear from you!',
    body: `
      <p class="fm-sub">Have questions, feedback,<br>recommendation? Drop as a line!</p>
      <div class="fm-row">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="4" width="21" height="16" rx="3.5" fill="#0b0b0b"/><path d="M3.5 7.5l8.5 6.2 8.5-6.2" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Gmail : lspusccsoccs@gmail.com</span>
      </div>
      <div class="fm-row">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#0b0b0b"/><path fill="#fff" d="M13.4 20v-6.9h2.3l.4-2.7h-2.7V8.7c0-.8.3-1.3 1.4-1.3h1.4V5c-.3 0-1.1-.1-2.1-.1-2.1 0-3.5 1.3-3.5 3.6v2H8.3v2.7h2.3V20h2.8z"/></svg>
        <span>Facebook: Student Organization of the College of Computer Studi(SOCCS)es</span>
      </div>`
  },
  forgot: {
    title: 'Forgot Password?',
    body: `
      <p style="margin:0 0 12px">Password resets are handled by the SOCCS Executive Board.</p>
      <p style="margin:0">Please reach out through the <strong>Contact</strong> window and an executive will help you get back in. Once you are logged in you can change your password anytime from <strong>Settings &rarr; Change Password</strong>.</p>`
  }
};

const overlay = document.getElementById('landingOverlay');
const lTitle  = document.getElementById('lModalTitle');
const lBody   = document.getElementById('lModalBody');

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    const c = MODAL_CONTENT[btn.dataset.modal];
    lTitle.textContent = c.title;
    lBody.innerHTML    = c.body;
    overlay.classList.toggle('contact-open', btn.dataset.modal === 'contact');
    overlay.classList.toggle('info-open', btn.dataset.modal === 'about' || btn.dataset.modal === 'features');
    overlay.classList.add('open');
  });
});
function closeLandingModal() {
  overlay.classList.remove('open', 'contact-open', 'info-open');
}
document.getElementById('lModalClose').onclick = closeLandingModal;
overlay.addEventListener('click', e => { if (e.target === overlay) closeLandingModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLandingModal(); });

document.getElementById('goForgot').addEventListener('click', () => {
  const c = MODAL_CONTENT.forgot;
  lTitle.textContent = c.title;
  lBody.innerHTML    = c.body;
  overlay.classList.remove('contact-open', 'info-open');
  overlay.classList.add('open');
});

/* ── Login form ─────────────────────────────────────────────────────────────── */
document.getElementById('login').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('err');
  errEl.textContent = '';
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.value, password: password.value })
  });
  if (r.ok) location.replace('dashboard.html');
  else errEl.textContent = (await r.json()).error || 'Could not log in.';
});

/* -- Create Account -------------------------------------------------------- */
document.getElementById('goRegister').addEventListener('click', () => {
  lTitle.textContent = 'Create Account';
  lBody.innerHTML = `
    <form id="regForm" class="fm-form">
      <label class="fm-label">
        FULL NAME
        <input name="full_name" class="field" placeholder="e.g. Maria Santos" pattern="[A-Za-z]+(?: [A-Za-z]+)*" title="Use letters only, with spaces between names." required>
      </label>
      <label class="fm-label">
        EMAIL ADDRESS
        <input name="email" type="email" class="field" placeholder="you@gmail.com" pattern="[A-Za-z]+@gmail\\.com" title="Use letters only before @gmail.com." required>
      </label>
      <label class="fm-label">
        <span>PASSWORD <span style="font-weight:400;letter-spacing:0">(8+ characters)</span></span>
        <input name="password" type="password" class="field" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" minlength="8" required>
      </label>
      <p style="margin:0;font-size:.92em;line-height:1.4;color:#f1e5ff">
        Your account will be submitted for <strong>executive approval</strong>.
        You can log in once an executive approves your request.
      </p>
      <p id="regMsg" class="fm-msg"></p>
      <button type="submit" class="btn" style="width:100%">SUBMIT REQUEST</button>
    </form>`;
  overlay.classList.remove('contact-open');
  overlay.classList.add('open');
  document.getElementById('regForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = document.getElementById('regMsg');
    msg.style.color = '#ffd1dc'; msg.textContent = '';
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(ev.target)))
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok) {
      msg.style.color = '#5eead4';
      msg.textContent = 'Request submitted! Wait for executive approval before logging in.';
      ev.target.reset();
    } else {
      msg.textContent = json.error || 'Registration failed.';
    }
  });
});
