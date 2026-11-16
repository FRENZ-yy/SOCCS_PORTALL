const $ = (id) => document.getElementById(id);
let currentUser = null;
let canManage = false;

function showConfirm(title, message, onConfirm) {
    $("confirmOverlayTitle").textContent = title;
    $("confirmOverlayMessage").textContent = message;
    $("confirmOverlayError").hidden = true;
    $("confirmOverlayError").textContent = "";
    const overlay = $("confirmOverlay");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    $("confirmOverlayCancel").focus();
    overlay._onConfirm = onConfirm;
}
function closeConfirmDialog() {
    const overlay = $("confirmOverlay");
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    overlay._onConfirm = null;
}
$("confirmOverlayClose").addEventListener("click", closeConfirmDialog);
$("confirmOverlayCancel").addEventListener("click", closeConfirmDialog);
$("confirmOverlay").addEventListener("click", (e) => { if (e.target === $("confirmOverlay")) closeConfirmDialog(); });
$("confirmOverlayConfirm").addEventListener("click", () => {
    const fn = $("confirmOverlay")._onConfirm;
    closeConfirmDialog();
    if (fn) fn();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeConfirmDialog(); });

if (localStorage.getItem("soccs-theme") === "light") document.body.classList.add("light-mode");

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

function setMessage(id, text, isError = false) {
    const element = $(id);
    element.textContent = text;
    element.classList.toggle("error", isError);
}

function cell(row, value) {
    const td = document.createElement("td");
    td.textContent = value || "";
    row.append(td);
    return td;
}

function createButton(text, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.addEventListener("click", handler);
    return button;
}

function renderPending(pending) {
    const list = $("pendingRequests");
    list.replaceChildren();
    $("pendingCount").textContent = `${pending.length} pending`;
    if (!pending.length) {
        const empty = document.createElement("p");
        empty.className = "member-empty-state";
        empty.textContent = "There are no requests waiting for approval.";
        list.append(empty);
        return;
    }

    pending.forEach((request, index) => {
        const item = document.createElement("article");
        item.className = "member-request-item";
        const info = document.createElement("div");
        info.className = "member-request-info";
        const title = document.createElement("strong");
        title.textContent = `${index + 1}. ${request.full_name}`;
        const email = document.createElement("span");
        email.textContent = request.email;
        const role = document.createElement("small");
        role.textContent = request.role;
        const officerId = document.createElement("small");
        officerId.textContent = request.officer_id;
        info.append(title, email, role, officerId);

        const actions = document.createElement("div");
        actions.className = "member-row-actions";
        actions.append(
            createButton("Approve", "member-primary-button", async (event) => {
                await updateRequest(event.currentTarget, request, "approve");
            }),
            createButton("Disapprove", "member-danger-button", async (event) => {
                await updateRequest(event.currentTarget, request, "disapprove");
            }),
        );
        item.append(info, actions);
        list.append(item);
    });
}

async function updateRequest(button, request, action) {
    if (action === "disapprove") {
        showConfirm("Disapprove Request", `Disapprove the request from ${request.full_name}? The pending account will be removed and its email can be used again.`, async () => {
            button.disabled = true;
            try {
                await requestJson(`/api/admin/requests/${request.id}`, { method: "DELETE" });
                await loadMembers();
            } catch (error) {
                setMessage("queueMessage", error.message, true);
                button.disabled = false;
            }
        });
        return;
    }
    button.disabled = true;
    try {
        await requestJson(`/api/admin/approve/${request.id}`, { method: "POST" });
        await loadMembers();
    } catch (error) {
        setMessage("queueMessage", error.message, true);
        button.disabled = false;
    }
}

function renderMembers(members) {
    const tbody = $("memberTable");
    tbody.replaceChildren();
    $("memberCount").textContent = `${members.length} ${members.length === 1 ? "member" : "members"}`;
    $("membersEmpty").hidden = members.length !== 0;

    members.forEach((member) => {
        const row = document.createElement("tr");
        cell(row, member.full_name);
        cell(row, member.officer_id);
        cell(row, member.email);
        const roleCell = cell(row, "");
        const badge = document.createElement("span");
        badge.className = "member-role-badge";
        badge.textContent = member.role;
        roleCell.append(badge);

        const actions = cell(row, "");
        if (canManage && member.id !== currentUser.id) {
            actions.classList.add("member-actions-cell");
            actions.append(
                createButton(
                    member.role === "Executive" ? "Make regular officer" : "Make executive",
                    "member-secondary-button",
                    async (event) => updateRole(event.currentTarget, member),
                ),
                createButton("Remove", "member-danger-button", async (event) => removeMember(event.currentTarget, member)),
            );
        } else if (member.id === currentUser.id) {
            actions.textContent = "You";
        } else {
            actions.textContent = "—";
        }
        tbody.append(row);
    });
}

async function updateRole(button, member) {
    const role = member.role === "Executive" ? "Regular Officer" : "Executive";
    showConfirm("Change Role", `Change ${member.full_name}'s role to ${role}?`, async () => {
    button.disabled = true;
    try {
        await requestJson(`/api/exec/users/${member.id}/role`, {
            method: "PATCH",
            body: JSON.stringify({ role }),
        });
        await loadMembers();
    } catch (error) {
        setMessage("rosterMessage", error.message, true);
        button.disabled = false;
    }
    });
}

async function removeMember(button, member) {
    showConfirm("Remove Account", `Remove ${member.full_name}'s account? This cannot be undone.`, async () => {
    button.disabled = true;
    try {
        await requestJson(`/api/exec/users/${member.id}`, { method: "DELETE" });
        await loadMembers();
    } catch (error) {
        setMessage("rosterMessage", error.message, true);
        button.disabled = false;
    }
    });
}

async function loadMembers() {
    const result = await requestJson("/api/members");
    canManage = result.permissions.manage;
    $("approvalSection").hidden = !canManage;
    $("memberRequestDescription").textContent = canManage
        ? "Accounts you add are active immediately. Requests submitted by officers or through sign-up still need your approval."
        : "New accounts stay pending until an executive approves the request.";
    $("memberRequestButton").textContent = canManage ? "Add account" : "Submit for executive approval";
    renderPending(result.pending);
    renderMembers(result.members);
    setMessage("queueMessage", "");
    setMessage("rosterMessage", "");
}

$("memberRequestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("requestError", "");
    setMessage("membersMessage", "");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
        const result = await requestJson("/api/members/requests", {
            method: "POST",
            body: JSON.stringify(data),
        });
        form.reset();
        setMessage("membersMessage", result.status === "Approved"
            ? "Account added and is ready to use."
            : "Member request submitted. An executive must approve the account before it can be used.");
        await loadMembers();
    } catch (error) {
        setMessage("requestError", error.message, true);
    }
});

(async () => {
    try {
        currentUser = await requestJson("/api/auth/me");
        $("headerUserName").textContent = currentUser.name;
        $("who").textContent = currentUser.name;
        $("profileDisplayName").textContent = currentUser.name;
        $("roleBadge").textContent = currentUser.role;
        if (currentUser.avatar) {
            const avatar = document.getElementById("headerAvatar");
            avatar.style.backgroundImage = `url('${currentUser.avatar}')`;
            avatar.querySelector("img").hidden = true;
        }
        await loadMembers();
    } catch (error) {
        if (!window.location.href.includes("index.html")) {
            setMessage("membersMessage", error.message, true);
        }
    }
})();
