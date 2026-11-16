const header = document.querySelector(".subpage-dashboard-header");
header.innerHTML = `
    <button type="button" class="hamb subpage-menu-button" id="subpageMenuButton" aria-label="Open menu" title="Menu" aria-expanded="false">
        <img src="assets/hamburgersettingicon.png" alt="Menu">
    </button>
    <div class="title-block">
        <h1 id="brand">SOCCS PORTAL</h1>
        <p id="todayLabel"></p>
    </div>
    <div class="dh-right">
        <input type="search" class="header-search" id="headerSearch" placeholder="Search..." aria-label="Search this page" autocomplete="off">
        <a href="settings.html" class="icon-btn" id="settingsLink" aria-label="Settings" title="Settings" target="_blank" rel="noopener">
            <img src="assets/settings-svgrepo-com.svg" alt="">
        </a>
        <div id="bellWrap" class="relative hidden">
            <button id="bellBtn" class="icon-btn" aria-label="Notifications" title="Notifications" aria-controls="bellOverlay" aria-expanded="false">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159a2.032 2.032 0 01-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
                </svg>
                <span id="bellDot" class="hidden"></span>
            </button>
        </div>
        <div class="profile-wrap">
            <button type="button" class="header-user" id="profileBtn" aria-haspopup="true" aria-expanded="false">
                <span class="hp-avatar" id="headerAvatar"><img src="assets/profile-circle-svgrepo-com.svg" alt=""></span>
                <span id="who" class="hp-name"></span>
            </button>
            <div class="profile-menu hidden" id="profileMenu">
                <div class="profile-info">
                    <strong id="profileDisplayName"></strong>
                    <span id="roleBadge" class="badge hidden"></span>
                </div>
                <button type="button" class="profile-item" id="switchAccountBtn">
                    <img src="assets/switch-user-icon-vector-removebg-preview.png" alt=""> Switch Account
                </button>
                <button type="button" class="profile-item danger" id="logout">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg> Log Out
                </button>
            </div>
        </div>
        <span id="headerUserName" class="sr-only"></span>
    </div>
`;
document.getElementById("bellWrap").insertAdjacentHTML("beforeend", `
    <div class="subpage-bell-overlay hidden" id="bellOverlay" role="dialog" aria-label="Notifications">
        <div class="subpage-bell-heading">
            <h2>Notifications</h2>
            <button type="button" id="markAllNotificationsRead">Mark all read</button>
            <button type="button" id="bellClose" aria-label="Close notifications">&times;</button>
        </div>
        <div id="bellList" class="subpage-bell-list"></div>
    </div>
`);

const menuButton = document.getElementById("subpageMenuButton");
const drawer = document.getElementById("subpageDrawer");
const scrim = document.getElementById("subpageDrawerScrim");
const closeButton = document.getElementById("subpageDrawerClose");
const profileButton = document.getElementById("profileBtn");
const profileMenu = document.getElementById("profileMenu");
const notificationOverlay = document.getElementById("bellOverlay");
const bellButton = document.getElementById("bellBtn");
const bellDot = document.getElementById("bellDot");
const bellList = document.getElementById("bellList");

function setDrawerOpen(open) {
    drawer.classList.toggle("open", open);
    scrim.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    menuButton.setAttribute("aria-expanded", String(open));
}

function setProfileOpen(open) {
    profileMenu.classList.toggle("hidden", !open);
    profileButton.setAttribute("aria-expanded", String(open));
}

function notificationTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

async function loadNotifications() {
    const response = await fetch("/api/notifications", { credentials: "same-origin" });
    if (response.status === 401) {
        window.location.replace("index.html");
        return [];
    }
    if (!response.ok) throw new Error("Could not load notifications.");
    const notifications = await response.json();
    const hasUnread = notifications.some((item) => !Number(item.is_read));
    bellDot.classList.toggle("hidden", !hasUnread);
    document.getElementById("markAllNotificationsRead").hidden = !hasUnread;
    bellList.replaceChildren();
    if (!notifications.length) {
        const empty = document.createElement("p");
        empty.className = "subpage-notification-item";
        empty.textContent = "No notifications yet.";
        bellList.append(empty);
        return notifications;
    }
    notifications.forEach((item) => {
        const row = document.createElement("div");
        const isRead = Boolean(Number(item.is_read));
        row.className = `subpage-notification-item${isRead ? "" : " new"}`;
        const message = document.createElement("p");
        message.textContent = item.message;
        const time = document.createElement("time");
        time.textContent = notificationTime(item.created_at);
        const status = document.createElement("span");
        status.className = `notification-state${isRead ? " read" : " unread"}`;
        status.textContent = isRead ? "Read" : "Unread";
        row.append(message, status, time);
        if (!isRead) {
            const readButton = document.createElement("button");
            readButton.type = "button";
            readButton.className = "notification-read-button";
            readButton.dataset.markNotification = item.id;
            readButton.textContent = "Mark as read";
            row.append(readButton);
        }
        bellList.append(row);
    });
    return notifications;
}

async function updateNotificationRead(body) {
    const response = await fetch("/api/notifications/read", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
        window.location.replace("index.html");
        throw new Error("Please sign in again.");
    }
    if (!response.ok) throw new Error(result.error || "Could not update notification status.");
}

bellList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-mark-notification]");
    if (!button) return;
    button.disabled = true;
    try {
        await updateNotificationRead({ notification_id: button.dataset.markNotification });
        await loadNotifications();
    } catch (error) {
        button.disabled = false;
        await systemDialog.alert(error.message, 'Could not update notification');
    }
});
document.getElementById("markAllNotificationsRead").addEventListener("click", async () => {
    try {
        await updateNotificationRead({ all: true });
        await loadNotifications();
    } catch (error) {
        await systemDialog.alert(error.message, 'Could not update notifications');
    }
});

menuButton.addEventListener("click", () => setDrawerOpen(true));
closeButton.addEventListener("click", () => setDrawerOpen(false));
scrim.addEventListener("click", () => setDrawerOpen(false));
profileButton.addEventListener("click", () => setProfileOpen(profileMenu.classList.contains("hidden")));
document.addEventListener("click", (event) => {
    if (!profileMenu.contains(event.target) && !profileButton.contains(event.target)) setProfileOpen(false);
    if (!notificationOverlay.contains(event.target) && !bellButton.contains(event.target)) {
        notificationOverlay.classList.add("hidden");
        bellButton.setAttribute("aria-expanded", "false");
    }
});
document.body.insertAdjacentHTML("beforeend", `
  <div id="switchAccountOverlay" class="overlay contact-open" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="switchAccountTitle">
    <section class="fm">
      <header class="fm-head">
        <img src="assets/logo.png" alt="" class="logo">
        <span class="org">Student Organization of the College of Computer Studies(SOCCS)</span>
        <button id="switchAccountClose" class="fm-close" type="button" aria-label="Close"><img src="assets/ekis.png" alt=""></button>
      </header>
      <div class="fm-body">
        <h2 id="switchAccountTitle" class="fm-title grad-text">Switch Account</h2>
        <div class="fm-content">
          <p>Log out of this account and return to the login page?</p>
          <p id="switchAccountError" role="alert" hidden></p>
          <div class="switch-account-actions">
            <button id="switchAccountCancel" class="btn" type="button">Cancel</button>
            <button id="switchAccountConfirm" class="btn" type="button">Switch Account</button>
          </div>
        </div>
      </div>
    </section>
  </div>
`);

function openSwitchAccountDialog() {
    const overlay = document.getElementById("switchAccountOverlay");
    const err = document.getElementById("switchAccountError");
    err.hidden = true;
    err.textContent = "";
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.getElementById("switchAccountCancel").focus();
}
function closeSwitchAccountDialog() {
    const overlay = document.getElementById("switchAccountOverlay");
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
}
document.getElementById("switchAccountClose").addEventListener("click", closeSwitchAccountDialog);
document.getElementById("switchAccountCancel").addEventListener("click", closeSwitchAccountDialog);
document.getElementById("switchAccountOverlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("switchAccountOverlay")) closeSwitchAccountDialog();
});
document.getElementById("switchAccountConfirm").addEventListener("click", async () => {
    const confirmBtn = document.getElementById("switchAccountConfirm");
    const cancelBtn = document.getElementById("switchAccountCancel");
    const errorMsg = document.getElementById("switchAccountError");
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    errorMsg.hidden = true;
    try {
        const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not log out. Please try again.");
        window.location.replace("index.html");
    } catch (error) {
        errorMsg.textContent = error.message || "Could not switch accounts. Please try again.";
        errorMsg.hidden = false;
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
    }
});

document.getElementById("logout").addEventListener("click", () => endSession());
document.getElementById("switchAccountBtn").addEventListener("click", () => {
    setProfileOpen(false);
    openSwitchAccountDialog();
});
document.getElementById("bellClose").addEventListener("click", () => {
    notificationOverlay.classList.add("hidden");
    bellButton.setAttribute("aria-expanded", "false");
});
bellButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!notificationOverlay.classList.contains("hidden")) {
        notificationOverlay.classList.add("hidden");
        bellButton.setAttribute("aria-expanded", "false");
        return;
    }
    try {
        await loadNotifications();
        notificationOverlay.classList.remove("hidden");
    } catch (error) {
        bellList.textContent = error.message;
        notificationOverlay.classList.remove("hidden");
    }
    bellButton.setAttribute("aria-expanded", "true");
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        setDrawerOpen(false);
        setProfileOpen(false);
        notificationOverlay.classList.add("hidden");
        bellButton.setAttribute("aria-expanded", "false");
    }
});

async function endSession() {
    try {
        const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not log out. Please try again.");
        window.location.replace("index.html");
    } catch (error) {
        await systemDialog.alert(error.message, 'Could not log out');
    }
}

function filterPage(query) {
    const normalized = query.trim().toLocaleLowerCase();
    const paymentSearch = document.getElementById("paymentSearch");
    if (paymentSearch) {
        paymentSearch.value = query;
        document.getElementById("paymentFilterForm").requestSubmit();
        return;
    }
    document.querySelectorAll(".members-card, .settings-card").forEach((card) => {
        card.hidden = Boolean(normalized) && !card.textContent.toLocaleLowerCase().includes(normalized);
    });
}

let searchTimer;
document.getElementById("headerSearch").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    const value = event.currentTarget.value;
    searchTimer = setTimeout(() => filterPage(value), 250);
});
document.getElementById("headerSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        clearTimeout(searchTimer);
        filterPage(event.currentTarget.value);
    }
});

function renderTodayLabel() {
    const now = new Date();
    const date = new Intl.DateTimeFormat("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
    }).formatToParts(now);
    const part = (type) => date.find((item) => item.type === type).value;
    document.getElementById("todayLabel").textContent =
        `Today is ${part("weekday")}, ${part("month").toUpperCase()} ${part("day")}, ${part("year")}`;
}

async function loadPortalHeader() {
    try {
        const response = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (response.status === 401) {
            window.location.replace("index.html");
            return;
        }
        if (!response.ok) throw new Error("Could not load your account details.");
        const user = await response.json();
        const isExecutive = user.role === "Executive";
        const drawerLinks = document.querySelectorAll("[data-drawer-page]");
        drawerLinks.forEach((link) => {
            if (link.dataset.drawerPage === "event") link.hidden = !isExecutive;
        });
        document.getElementById("brand").textContent = isExecutive ? "EXECUTIVE DASHBOARD" : "SOCCS PORTAL";
        document.body.classList.toggle("exec-bg", isExecutive);
        document.getElementById("who").textContent = user.name;
        document.getElementById("headerUserName").textContent = user.name;
        document.getElementById("profileDisplayName").textContent = user.name;
        const badge = document.getElementById("roleBadge");
        badge.textContent = user.role;
        badge.className = `badge ${isExecutive ? "badge-exec" : "badge-officer"}`;
        if (user.avatar) {
            const avatar = document.getElementById("headerAvatar");
            avatar.style.backgroundImage = `url('${user.avatar}')`;
            avatar.classList.add("photo");
        }
        document.getElementById("bellWrap").classList.remove("hidden");
        await loadNotifications();
    } catch (error) {
        console.error(error);
    }
}

renderTodayLabel();
loadPortalHeader();
