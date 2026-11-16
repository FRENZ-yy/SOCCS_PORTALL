/* Settings page: change name, Gmail, password, profile photo, and dark / light mode. */
const $ = (id) => document.getElementById(id);
let currentAvatar = "";
let pendingAvatar = null;
let me = null;

async function requestJson(url, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
        });
    } catch {
        throw new Error("Cannot connect to the server. Start it with `python app.py` from the backend folder.");
    }
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
        window.location.replace("index.html");
        throw new Error("Please sign in again.");
    }
    if (!response.ok) throw new Error(result.error || result.message || "The request could not be completed.");
    return result;
}

function setMessage(text, isError = false) {
    $("settingsMessage").textContent = text;
    $("settingsMessage").classList.toggle("error", isError);
}

function showAvatar(avatar, name) {
    const box = $("avatarPreview");
    if (avatar) {
        box.style.backgroundImage = `url('${avatar}')`;
        box.textContent = "";
    } else {
        box.style.backgroundImage = "";
        box.textContent = (name || "?")[0].toUpperCase();
    }
}

/* Theme (shared with the dashboard through localStorage 'soccs-theme') */
function updateThemeToggle() {
    const dark = !document.body.classList.contains("light-mode");
    $("themeLabel").textContent = dark ? "Switch to Light Mode" : "Switch to Dark Mode";
    $("themeToggle").setAttribute("aria-pressed", String(dark));
    $("themeImage").src = dark ? "assets/moon-stars-svgrepo-com.svg" : "assets/moon-cloud-svgrepo-com.svg";
}
if (localStorage.getItem("soccs-theme") === "light") document.body.classList.add("light-mode");
updateThemeToggle();
$("themeToggle").addEventListener("click", () => {
    const light = document.body.classList.toggle("light-mode");
    localStorage.setItem("soccs-theme", light ? "light" : "dark");
    updateThemeToggle();
});

$("avatarPreview").addEventListener("click", () => $("avatarFile").click());
$("avatarFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        pendingAvatar = reader.result;
        showAvatar(pendingAvatar, $("accountName").value);
    };
    reader.readAsDataURL(file);
});

$("accountForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("accountError").textContent = "";
    setMessage("");
    const name = $("accountName").value.trim();
    const email = $("accountEmail").value.trim();
    if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(name)) {
        $("accountError").textContent = "Use letters only in the full name, with spaces between names.";
        return;
    }
    if (email.toLowerCase() !== (me.email || "").toLowerCase() && !/^[A-Za-z]+@gmail\.com$/.test(email)) {
        $("accountError").textContent = "Use letters only before @gmail.com.";
        return;
    }
    const current = $("accountCurrentPassword").value;
    const next = $("accountNewPassword").value;
    const confirm = $("accountConfirmPassword").value;
    const changingPassword = Boolean(current || next || confirm);
    if (changingPassword) {
        if (next.length < 8) { $("accountError").textContent = "The new password must be at least 8 characters."; return; }
        if (next !== confirm) { $("accountError").textContent = "The new passwords do not match."; return; }
        if (!current) { $("accountError").textContent = "Enter your current password to set a new one."; return; }
    }
    try {
        await requestJson("/api/auth/edit-profile", { method: "POST", body: JSON.stringify({ full_name: name, email }) });
        if (pendingAvatar && pendingAvatar !== currentAvatar) {
            await requestJson("/api/auth/avatar", { method: "POST", body: JSON.stringify({ avatar: pendingAvatar }) });
            currentAvatar = pendingAvatar;
        }
        if (changingPassword) {
            await requestJson("/api/auth/change-password", {
                method: "POST",
                body: JSON.stringify({ old_password: current, new_password: next }),
            });
            $("accountCurrentPassword").value = "";
            $("accountNewPassword").value = "";
            $("accountConfirmPassword").value = "";
        }
        $("headerUserName").textContent = name;
        $("who").textContent = name;
        $("profileDisplayName").textContent = name;
        setMessage(changingPassword ? "Account and password saved." : "Account saved.");
    } catch (error) {
        $("accountError").textContent = error.message;
    }
});

(async () => {
    try {
        me = await requestJson("/api/auth/me");
    } catch { return; }
    $("headerUserName").textContent = me.name;
    $("who").textContent = me.name;
    $("profileDisplayName").textContent = me.name;
    $("roleBadge").textContent = me.role;
    $("backupCard").hidden = me.role !== "Executive";
    if (me.avatar) {
        const avatar = document.getElementById("headerAvatar");
        avatar.style.backgroundImage = `url('${me.avatar}')`;
        avatar.querySelector("img").hidden = true;
    }
    $("accountName").value = me.name;
    $("accountEmail").value = me.email || "";
    currentAvatar = me.avatar || "";
    showAvatar(currentAvatar, me.name);
})();
