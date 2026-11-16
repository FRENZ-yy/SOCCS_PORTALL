/* Membership fee ledger for student-body members who do not need portal accounts. */
let paymentChoices = [];
let ledgerRows = [];
let schoolYear = "2025-2026";
let permissions = { record: false };
let ledgerSort = { key: "full_name", direction: "asc" };

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

function applyAccess() {
    document.getElementById("editMemberListButton").hidden = !permissions.record;
    document.getElementById("recordPaymentButton").hidden = !permissions.record;
    document.getElementById("downloadLedgerButton").hidden = !permissions.record;
    document.body.classList.toggle("financial-hidden", !permissions.record);
}

/* Same light/dark choice as the dashboard (saved by the Settings page). */
if (localStorage.getItem("soccs-theme") === "light") document.body.classList.add("light-mode");
document.body.classList.add("financial-hidden");

(async () => {
    try {
        const me = await requestJson("/api/auth/me");
        document.getElementById("headerUserName").textContent = me.name;
        document.getElementById("who").textContent = me.name;
        document.getElementById("profileDisplayName").textContent = me.name;
        document.getElementById("roleBadge").textContent = me.role;
        if (me.avatar) {
            const avatar = document.getElementById("headerAvatar");
            avatar.style.backgroundImage = `url('${me.avatar}')`;
            avatar.querySelector("img").hidden = true;
        }
    } catch { return; }
    applyAccess();
    loadPayments();
})();

function appendCell(row, value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value === null || value === undefined ? "" : value;
    row.append(cell);
    return cell;
}

function renderSectionChart(rows) {
    const chart = document.getElementById("courseChart");
    chart.replaceChildren();
    if (!rows.length) return;
    const peak = Math.max(...rows.map((row) => Math.max(row.collected, row.outstanding, 1)));
    rows.forEach((row) => {
        const line = document.createElement("div");
        line.className = "chart-row";
        const label = document.createElement("span");
        label.className = "chart-label";
        label.textContent = row.section;
        const bars = document.createElement("div");
        bars.className = "chart-bars";
        [["collected", row.collected], ["outstanding", row.outstanding]].forEach(([kind, amount]) => {
            const bar = document.createElement("div");
            bar.className = `chart-bar ${kind}`;
            bar.style.width = `${Math.max((amount / peak) * 100, amount > 0 ? 12 : 0)}%`;
            bar.textContent = peso(amount);
            bars.append(bar);
        });
        line.append(label, bars);
        chart.append(line);
    });
    const legend = document.createElement("p");
    legend.className = "chart-legend";
    legend.innerHTML = '<i class="collected"></i>Collected <i class="outstanding"></i>Outstanding';
    chart.append(legend);
}

function peso(amount) {
    return `₱${Number(amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusPill(status) {
    const pill = document.createElement("span");
    pill.className = `status-pill ${String(status || "").toLowerCase().replace(/\s+/g, "-")}`;
    pill.textContent = status;
    return pill;
}

function setNamedMessage(elementId, text, isError = false) {
    const element = document.getElementById(elementId);
    element.textContent = text;
    element.classList.toggle("error", isError);
}

function fillSelect(select, values, placeholder, labelOf = (value) => value) {
    const current = select.value;
    select.replaceChildren(new Option(placeholder, ""));
    values.forEach((value) => select.add(new Option(labelOf(value), value)));
    if ([...select.options].some((option) => option.value === current)) select.value = current;
}

async function loadPayments() {
    const params = new URLSearchParams();
    const keyword = document.getElementById("paymentSearch").value.trim();
    const section = document.getElementById("paymentSection").value;
    const payStatus = document.getElementById("paymentStatus").value;
    if (keyword) params.set("q", keyword);
    if (section) params.set("section", section);
    if (payStatus) params.set("pay_status", payStatus);
    try {
        const result = await requestJson(`/api/payments?${params}`);
        permissions = result.permissions || permissions;
        paymentChoices = result.choices || [];
        ledgerRows = result.ledger;
        fillSelect(document.getElementById("paymentSection"), result.options.sections || [], "All sections");
        fillSelect(document.getElementById("paymentStatus"), result.options.ledger_statuses, "All statuses");
        applyAccess();
        document.getElementById("membershipFunds").textContent = peso(result.funds);
        if (permissions.record) {
            document.getElementById("paymentCollected").textContent = peso(result.summary.collected);
            document.getElementById("paymentOutstanding").textContent = peso(result.summary.outstanding);
            schoolYear = result.school_year || schoolYear;
            renderSectionChart(result.by_section || []);
            renderPaymentRecords(result.payments || []);
        }
        renderLedger(result.ledger);
    } catch (error) {
        setNamedMessage("paymentMessage", error.message, true);
    }
}

function renderLedger(rows) {
    const table = document.getElementById("duesTable");
    table.replaceChildren();
    document.getElementById("duesEmpty").hidden = rows.length !== 0;
    const sortedRows = [...rows].sort((a, b) => {
        const left = a[ledgerSort.key] ?? "";
        const right = b[ledgerSort.key] ?? "";
        const comparison = typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
        return ledgerSort.direction === "asc" ? comparison : -comparison;
    });
    document.querySelectorAll(".ledger-sort").forEach((button) => {
        const header = button.closest("th");
        const active = button.dataset.sort === ledgerSort.key;
        header.setAttribute("aria-sort", active ? (ledgerSort.direction === "asc" ? "ascending" : "descending") : "none");
        button.textContent = button.textContent.replace(/[↑↓]$/, "").trim() + (active ? (ledgerSort.direction === "asc" ? " ↑" : " ↓") : "");
    });
    sortedRows.forEach((row) => {
        const tr = document.createElement("tr");
        const name = appendCell(tr, row.full_name, "member-name");
        appendCell(tr, row.student_number);
        appendCell(tr, row.section || "Unassigned");
        if (permissions.record) {
            appendCell(tr, peso(row.annual_dues), "financial-only");
            appendCell(tr, peso(row.amount_paid), "financial-only");
            appendCell(tr, peso(row.balance), "financial-only");
        }
        const statusCell = document.createElement("td");
        statusCell.append(statusPill(row.payment_status));
        tr.append(statusCell);
        table.append(tr);
    });
}

function renderPaymentRecords(payments) {
    const table = document.getElementById("paymentTable");
    table.replaceChildren();
    document.getElementById("paymentEmpty").hidden = payments.length !== 0;
    payments.forEach((payment) => {
        const tr = document.createElement("tr");
        appendCell(tr, payment.date);
        const member = appendCell(tr, payment.member_name, "member-name");
        const received = document.createElement("span");
        received.className = "member-subtle";
        received.textContent = payment.received_by ? `Received by ${payment.received_by}` : "";
        member.append(received);
        appendCell(tr, peso(payment.amount));
        appendCell(tr, payment.method);
        appendCell(tr, payment.reference || "—");
        const statusCell = document.createElement("td");
        statusCell.append(statusPill(payment.status === "Approved" ? "Received" : payment.status));
        tr.append(statusCell);
        const receiptCell = document.createElement("td");
        const receiptButton = document.createElement("button");
        receiptButton.type = "button";
        receiptButton.className = "member-secondary-button";
        receiptButton.textContent = "View";
        receiptButton.addEventListener("click", () => showReceipt(payment));
        receiptCell.append(receiptButton);
        tr.append(receiptCell);
        table.append(tr);
    });
}

function showReceipt(payment) {
    const member = paymentChoices.find((choice) => choice.member_id === payment.member_id);
    const rows = [
        ["Receipt", payment.payment_id],
        ["Member", payment.member_name || member?.full_name || payment.member_id],
        ["Amount", peso(payment.amount)],
        ["Date", payment.date],
        ["Method", payment.method],
        ["Reference", payment.reference || "—"],
        ["Received by", payment.received_by || "—"],
        ["Recorded by", payment.recorded_by || "—"],
        ["Note", payment.note || "—"],
    ];
    const body = document.getElementById("receiptBody");
    body.replaceChildren();
    rows.forEach(([label, value]) => {
        const row = document.createElement("div");
        const name = document.createElement("span");
        name.textContent = label;
        const detail = document.createElement("strong");
        detail.textContent = value;
        row.append(name, detail);
        body.append(row);
    });
    document.getElementById("receiptDialog").showModal();
}

function openPaymentDialog(preset = {}) {
    const form = document.getElementById("paymentForm");
    form.reset();
    document.getElementById("paymentFormError").textContent = "";
    const select = document.getElementById("paymentMember");
    select.replaceChildren(new Option("Choose member", ""));
    paymentChoices.forEach((choice) => {
        select.add(new Option(`${choice.full_name} (${choice.student_number || choice.member_id})`, choice.member_id));
    });
    document.getElementById("paymentDate").value = new Date().toISOString().slice(0, 10);
    document.getElementById("paymentReceivedBy").value = document.getElementById("headerUserName").textContent;
    if (preset.amount) document.getElementById("paymentAmount").value = preset.amount;
    if (preset.note) document.getElementById("paymentNote").value = preset.note;
    if (preset.member_id) select.value = preset.member_id;
    document.getElementById("paymentDialog").showModal();
}

document.getElementById("recordPaymentButton").addEventListener("click", () => openPaymentDialog());
async function openMemberRosterDialog() {
    if (!permissions.record) return;
    document.getElementById("memberRosterForm").reset();
    document.getElementById("memberRosterError").textContent = "";
    document.getElementById("sectionRenameError").textContent = "";
    try {
        await loadRosterEditor();
        document.getElementById("memberRosterDialog").showModal();
    } catch (error) {
        setNamedMessage("paymentMessage", error.message, true);
    }
}

document.getElementById("editMemberListButton").addEventListener("click", openMemberRosterDialog);

function rosterInput(value, ariaLabel) {
    const input = document.createElement("input");
    input.className = "roster-row-input";
    input.value = value || "";
    input.setAttribute("aria-label", ariaLabel);
    return input;
}

function actionButton(label, onClick, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className || "member-secondary-button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
}

async function loadRosterEditor() {
    const result = await requestJson("/api/payments/members/roster");
    const roster = result.members;
    const sections = [...new Set(roster.map((student) => student.section).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    fillSelect(document.getElementById("renameFromSection"), sections, "Choose section");
    const table = document.getElementById("rosterTable");
    table.replaceChildren();
    document.getElementById("rosterEmpty").hidden = roster.length !== 0;
    roster.forEach((student) => {
        const row = document.createElement("tr");
        const studentNumber = rosterInput(student.student_number, `Student number for ${student.full_name}`);
        const fullName = rosterInput(student.full_name, `Name for ${student.student_number}`);
        fullName.pattern = "[A-Za-z]+(?: [A-Za-z]+)*";
        fullName.title = "Use letters only, with spaces between names.";
        const section = rosterInput(student.section, `Section for ${student.full_name}`);
        [
            [studentNumber, "Student number"],
            [fullName, "Name"],
            [section, "Section"],
        ].forEach(([input, label]) => {
            const cell = appendCell(row, "");
            cell.dataset.label = label;
            cell.append(input);
        });
        const statusCell = document.createElement("td");
        statusCell.dataset.label = "Status";
        statusCell.append(statusPill(student.status));
        row.append(statusCell);

        const actionsCell = document.createElement("td");
        actionsCell.dataset.label = "Actions";
        const actions = document.createElement("div");
        actions.className = "roster-row-actions";
        const saveButton = actionButton("Save", async () => {
            if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(fullName.value.trim())) {
                setNamedMessage("memberRosterError", "Use letters only in the full name, with spaces between names.", true);
                return;
            }
            saveButton.disabled = true;
            try {
                const result = await requestJson(`/api/payments/members/${encodeURIComponent(student.member_id)}`, {
                    method: "PUT",
                    body: JSON.stringify({
                        student_number: studentNumber.value.trim(),
                        full_name: fullName.value.trim(),
                        section: section.value.trim(),
                        status: student.status,
                    }),
                });
                await Promise.all([loadRosterEditor(), loadPayments()]);
                setNamedMessage("paymentMessage", result.message);
            } catch (error) {
                setNamedMessage("memberRosterError", error.message, true);
                saveButton.disabled = false;
            }
        });
        const statusButton = actionButton(student.status === "Dropped" ? "Reinstate" : "Mark dropped", async () => {
            if (student.status !== "Dropped" && !await systemDialog.confirm(`Mark ${student.full_name} as dropped? Their fee history will be retained.`, { title: 'Mark member as dropped', confirmText: 'Mark dropped', danger: true })) return;
            statusButton.disabled = true;
            try {
                await requestJson(`/api/payments/members/${encodeURIComponent(student.member_id)}`, {
                    method: "PUT",
                    body: JSON.stringify({
                        student_number: studentNumber.value.trim(),
                        full_name: fullName.value.trim(),
                        section: section.value.trim(),
                        status: student.status === "Dropped" ? "Active" : "Dropped",
                    }),
                });
                await Promise.all([loadRosterEditor(), loadPayments()]);
                setNamedMessage("paymentMessage", student.status === "Dropped" ? "Student reinstated." : "Student marked as dropped; fee history was kept.");
            } catch (error) {
                setNamedMessage("memberRosterError", error.message, true);
                statusButton.disabled = false;
            }
        }, student.status === "Dropped" ? "" : "member-delete-button");
        actions.append(saveButton, statusButton);
        actionsCell.append(actions);
        row.append(actionsCell);
        table.append(row);
    });
}

document.getElementById("sectionRenameForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("sectionRenameError");
    error.textContent = "";
    try {
        const result = await requestJson("/api/payments/sections", {
            method: "PUT",
            body: JSON.stringify({
                section: document.getElementById("renameFromSection").value,
                new_section: document.getElementById("renameToSection").value.trim(),
            }),
        });
        document.getElementById("renameToSection").value = "";
        await Promise.all([loadRosterEditor(), loadPayments()]);
        setNamedMessage("paymentMessage", result.message);
    } catch (requestError) {
        error.textContent = requestError.message;
    }
});

document.getElementById("closeMemberRosterButton").addEventListener("click", () => {
    document.getElementById("memberRosterDialog").close();
});
document.getElementById("cancelMemberRosterButton").addEventListener("click", () => document.getElementById("memberRosterDialog").close());
document.getElementById("closePaymentButton").addEventListener("click", () => document.getElementById("paymentDialog").close());
document.getElementById("cancelPaymentButton").addEventListener("click", () => document.getElementById("paymentDialog").close());
document.getElementById("closeReceiptButton").addEventListener("click", () => document.getElementById("receiptDialog").close());
document.getElementById("doneReceiptButton").addEventListener("click", () => document.getElementById("receiptDialog").close());
document.getElementById("paymentFilterForm").addEventListener("submit", (event) => {
    event.preventDefault();
    loadPayments();
});
document.querySelectorAll(".ledger-sort").forEach((button) => {
    button.addEventListener("click", () => {
        const key = button.dataset.sort;
        ledgerSort = {
            key,
            direction: ledgerSort.key === key && ledgerSort.direction === "asc" ? "desc" : "asc",
        };
        renderLedger(ledgerRows);
    });
});
document.getElementById("memberRosterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("memberRosterError");
    error.textContent = "";
    const rows = document.getElementById("rosterStudents").value
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const students = [];
    for (const [index, line] of rows.entries()) {
        const separator = line.includes("\t") ? "\t" : ",";
        const splitAt = line.indexOf(separator);
        if (splitAt < 0) {
            error.textContent = `Line ${index + 1} needs a student number and name separated by a comma or tab.`;
            return;
        }
        const student_number = line.slice(0, splitAt).trim();
        const full_name = line.slice(splitAt + 1).trim();
        if (students.length === 0 && /student\s*(number|no\.?)/i.test(student_number) && /name/i.test(full_name)) continue;
        if (!student_number || !full_name) {
            error.textContent = `Line ${index + 1} needs both a student number and name.`;
            return;
        }
        if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(full_name)) {
            error.textContent = `Line ${index + 1} name must use letters and spaces only.`;
            return;
        }
        students.push({ student_number, full_name });
    }
    if (!students.length) {
        error.textContent = "Paste at least one student number and name.";
        return;
    }
    try {
        const result = await requestJson("/api/payments/members/import", {
            method: "POST",
            body: JSON.stringify({
                section: document.getElementById("rosterSection").value.trim(),
                students,
            }),
        });
        document.getElementById("memberRosterDialog").close();
        await loadRosterEditor();
        await loadPayments();
        setNamedMessage("paymentMessage", result.message);
    } catch (requestError) {
        error.textContent = requestError.message;
    }
});
document.getElementById("paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.amount = Number(payload.amount);
    payload.date = String(payload.date || "").slice(0, 10);
    try {
        const result = await requestJson("/api/payments", { method: "POST", body: JSON.stringify(payload) });
        document.getElementById("paymentDialog").close();
        await loadPayments();
        setNamedMessage("paymentMessage", result.message);
    } catch (error) {
        document.getElementById("paymentFormError").textContent = error.message;
    }
});
function pdfPlain(value) {
    return String(value ?? "").replace(/₱/g, "PHP ").replace(/[^\x20-\x7E]/g, "");
}

function pdfText(value) {
    return pdfPlain(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfMoney(amount) {
    return `PHP ${Number(amount || 0).toFixed(2)}`;
}

function buildDuesPdf(rows) {
    const columns = [
        { title: "Student No.", width: 62, align: "left", value: (row) => row.student_number || row.member_id },
        { title: "Name", width: 118, align: "left", value: (row) => row.full_name, max: 22 },
        { title: "Section", width: 54, align: "left", value: (row) => row.section, max: 10 },
        { title: "Due", width: 68, align: "right", value: (row) => pdfMoney(row.annual_dues) },
        { title: "Paid", width: 68, align: "right", value: (row) => pdfMoney(row.amount_paid) },
        { title: "Balance", width: 68, align: "right", value: (row) => pdfMoney(row.balance) },
        { title: "Status", width: 58, align: "left", value: (row) => row.payment_status },
    ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const left = 36;
    const top = 800;
    const bottom = 72;
    const rowHeight = 16;
    const generated = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const org = document.querySelector(".sidebar-brand span")?.textContent || "SOCCS";
    const collected = rows.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
    const outstanding = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
    const due = rows.reduce((sum, row) => sum + Number(row.annual_dues || 0), 0);

    function paint(font, size, x, y, value, color = "0 0 0") {
        return `${color} rg\nBT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfText(value)}) Tj ET\n`;
    }

    function cellText(column, value, y, bold = false) {
        const shown = column.max ? pdfPlain(value).slice(0, column.max) : pdfPlain(value);
        const font = bold ? "F2" : "F1";
        const size = 8;
        if (column.align === "right") {
            const width = shown.length * size * 0.5;
            return paint(font, size, left + column.x + column.width - 6 - width, y, shown);
        }
        return paint(font, size, left + column.x + 4, y, shown);
    }

    let cursor = 0;
    columns.forEach((column) => {
        column.x = cursor;
        cursor += column.width;
    });

    const pages = [];
    let index = 0;

    while (index < rows.length || pages.length === 0) {
        let stream = "";
        stream += "0.49 0.24 0.61 rg\n0 800 595 42 re f\n";
        stream += paint("F2", 16, left, 816, org, "1 1 1");
        stream += paint("F1", 9, left, 804, "Membership fee report", "1 1 1");
        let y = 776;
        if (pages.length === 0) {
            stream += paint("F2", 13, left, y, "Printable membership fee report");
            y -= 16;
            stream += paint("F1", 9, left, y, `School year ${schoolYear}    Generated ${generated}`);
            y -= 14;
            stream += paint("F1", 9, left, y, `Members ${rows.length}    Due ${pdfMoney(due)}    Collected ${pdfMoney(collected)}    Outstanding ${pdfMoney(outstanding)}`);
            y -= 18;
        }
        stream += `0.93 0.89 0.96 rg\n${left} ${y - 4} ${tableWidth} 16 re f\n`;
        columns.forEach((column) => {
            stream += cellText(column, column.title, y, true);
        });
        y -= rowHeight;
        while (index < rows.length && y >= bottom) {
            if ((index % 2) === 0) {
                stream += `0.97 0.97 0.98 rg\n${left} ${y - 4} ${tableWidth} ${rowHeight} re f\n`;
            }
            columns.forEach((column) => {
                stream += cellText(column, column.value(rows[index]), y);
            });
            y -= rowHeight;
            index += 1;
        }
        if (index >= rows.length) {
            y -= 6;
            stream += `0.45 0.4 0.5 RG\n0.8 w\n${left} ${y + 10} m ${left + tableWidth} ${y + 10} l S\n`;
            stream += paint("F2", 9, left, y, `Total due ${pdfMoney(due)}    Total collected ${pdfMoney(collected)}    Total outstanding ${pdfMoney(outstanding)}`);
            if (!rows.length) {
                stream += paint("F1", 10, left, y - 18, "No members in this report.");
            }
        }
        stream += paint("F1", 8, left, 28, "PAGE_NN_OF_MM", "0.35 0.3 0.4");
        pages.push(stream);
        if (index >= rows.length) break;
    }
    pages.forEach((stream, pageIndex) => {
        pages[pageIndex] = stream.replace("PAGE_NN_OF_MM", `${org}    Page ${pageIndex + 1} of ${pages.length}`);
    });

    const objectCount = 4 + pages.length * 2;
    const bodies = new Array(objectCount + 1);
    bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    const kids = pages.map((_, pageIndex) => `${6 + pageIndex * 2} 0 R`).join(" ");
    bodies[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`;
    bodies[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    bodies[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
    pages.forEach((stream, pageIndex) => {
        bodies[5 + pageIndex * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
        bodies[6 + pageIndex * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${5 + pageIndex * 2} 0 R >>`;
    });

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (let objectId = 1; objectId <= objectCount; objectId += 1) {
        offsets.push(pdf.length);
        pdf += `${objectId} 0 obj\n${bodies[objectId]}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 ${objectCount + 1}\n`;
    pdf += "0000000000 65535 f \n";
    for (let objectId = 1; objectId <= objectCount; objectId += 1) {
        pdf += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: "application/pdf" });
}

document.getElementById("downloadLedgerButton").addEventListener("click", () => {
    const file = buildDuesPdf(ledgerRows);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "SOCCS-membership-fee-report.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    setNamedMessage("paymentMessage", "PDF report downloaded. Open SOCCS-membership-fee-report.pdf to print it.");
});
