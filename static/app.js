let currentTaskId = null;
let pollTimer = null;
let currentDepth = "simple";
let currentFormat = "bullets";
let currentSummary = "";
let currentTranscript = "";
let currentSegments = [];
let lastLogMessage = "";

let meshEffect = null;

function $(id) {
    return document.getElementById(id);
}

function showToast(text) {
    const toast = $("toast");
    const msg = $("toastMessage");
    if (!toast || !msg) return;
    msg.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2400);
}

function showError(text) {
    $("progressSection").style.display = "none";
    $("resultSection").style.display = "none";
    $("errorSection").style.display = "flex";
    $("errorMessage").textContent = text || "Unknown error";
}

function hideError() {
    $("errorSection").style.display = "none";
}

function showProgress() {
    $("progressSection").style.display = "block";
    $("resultSection").style.display = "none";
    $("errorSection").style.display = "none";
    updateProgressText("Preparing task...");
}

function setButtonLoading(loading) {
    const btn = $("summarizeBtn");
    if (!btn) return;
    btn.disabled = !!loading;
    btn.innerHTML = loading
        ? '<i class="fas fa-spinner fa-spin"></i><span>Processing...</span>'
        : '<i class="fas fa-play"></i><span>开始总结</span>';
}

function updateProgressText(text) {
    const detail = $("progressDetail");
    if (!detail) return;
    const span = detail.querySelector("span");
    if (span) span.textContent = text || "Processing...";
}

function stepByStage(stage) {
    const s = (stage || "").toLowerCase();
    if (s.includes("prepar")) return "step-parse";
    if (s.includes("download")) return "step-download";
    if (s.includes("extract")) return "step-audio";
    if (s.includes("transcrib")) return "step-transcribe";
    if (s.includes("summar")) return "step-summary";
    if (s.includes("complete") || s.includes("fail")) return "step-complete";
    return "step-parse";
}

function resetSteps() {
    const wrappers = document.querySelectorAll(".step-wrapper");
    const connectors = document.querySelectorAll(".step-connector");
    wrappers.forEach((w) => (w.className = "step-wrapper"));
    connectors.forEach((c) => (c.className = "step-connector"));
}

function markStep(stage, done = false) {
    const order = [
        "step-parse",
        "step-download",
        "step-audio",
        "step-transcribe",
        "step-summary",
        "step-complete",
    ];
    const current = stepByStage(stage);
    const idx = Math.max(0, order.indexOf(current));
    const wrappers = document.querySelectorAll(".step-wrapper");
    const connectors = document.querySelectorAll(".step-connector");

    wrappers.forEach((w, i) => {
        w.classList.remove("active", "completed", "loading");
        if (i < idx || (done && i <= idx)) w.classList.add("completed");
        if (!done && i === idx) w.classList.add("active", "loading");
    });

    connectors.forEach((c, i) => {
        if (i < idx) c.className = "step-connector completed";
        else if (i === idx) c.className = "step-connector active";
        else c.className = "step-connector";
    });
}

function clearInfoPanel() {
    const info = $("infoContent");
    const log = $("logContent");
    if (info) info.innerHTML = '<div class="info-empty">Waiting for first status update...</div>';
    if (log) log.innerHTML = '<div class="log-empty">No logs yet.</div>';
    lastLogMessage = "";
}

function addLogEntry(message, type = "info") {
    if (!message || message === lastLogMessage) return;
    lastLogMessage = message;

    const log = $("logContent");
    if (!log) return;
    const empty = log.querySelector(".log-empty");
    if (empty) empty.remove();

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(
        now.getSeconds()
    ).padStart(2, "0")}`;
    const row = document.createElement("div");
    row.className = `log-entry ${type}`;
    row.innerHTML = `<span class="log-time">[${time}]</span> ${escapeHtml(message)}`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
}

function updateInfoPanel(data) {
    const info = $("infoContent");
    if (!info) return;
    const timing = data.timing || {};
    const token = data.token_usage;
    const transcriptChars = (data.transcript || "").length;

    const cards = [];
    cards.push(["Task Status", String(data.status || "-")]);
    cards.push(["Current Stage", String(data.stage || "-")]);
    cards.push(["Progress", `${Number(data.progress || 0)}%`]);
    if (data.video_title) cards.push(["Video Title", String(data.video_title)]);

    if (timing.download !== undefined) cards.push(["Download", `${timing.download}s`]);
    if (timing.audio_extract !== undefined) cards.push(["Audio Extract", `${timing.audio_extract}s`]);
    if (timing.transcribe !== undefined) cards.push(["Transcribe", `${timing.transcribe}s`]);
    if (timing.summarize !== undefined) cards.push(["Summary", `${timing.summarize}s`]);
    if (timing.total !== undefined) cards.push(["Total", `${timing.total}s`]);

    if (token !== undefined && token !== null) cards.push(["Output Tokens", String(token)]);
    if (transcriptChars > 0) cards.push(["Transcript Chars", String(transcriptChars)]);

    info.innerHTML = cards
        .map(
            ([k, v]) =>
                `<div class="info-item"><span class="info-item-label">${escapeHtml(k)}</span><span class="info-item-value">${escapeHtml(v)}</span></div>`
        )
        .join("");
}

async function startSummarize() {
    const input = $("videoUrl");
    const url = (input ? input.value : "").trim();
    if (!url) {
        showError("Please enter a video URL.");
        return;
    }

    hideError();
    resetSteps();
    showProgress();
    clearInfoPanel();
    setButtonLoading(true);
    markStep("preparing");
    addLogEntry("Task submitted.");

    try {
        const resp = await fetch("/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, depth: currentDepth }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || "Request failed");
        currentTaskId = data.task_id;
        addLogEntry(`Task created: ${currentTaskId}`);
        startPolling();
    } catch (err) {
        setButtonLoading(false);
        const msg = err && err.message ? err.message : "Request failed";
        showError(msg);
        addLogEntry(msg, "error");
    }
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
        if (!currentTaskId) return;
        try {
            const resp = await fetch(`/api/status/${currentTaskId}`);
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || "Status request failed");

            updateProgressText(data.message || "Processing...");
            markStep(data.stage, data.status === "completed");
            updateInfoPanel(data);
            addLogEntry(data.message || data.stage || "Status update");

            if (data.status === "completed") {
                stopPolling();
                setButtonLoading(false);
                showResult(data.result, data.transcript, data.segments);
                addLogEntry("Task completed.", "success");
                showToast("Completed");
            } else if (data.status === "failed") {
                stopPolling();
                setButtonLoading(false);
                showError(data.message || "Task failed.");
                addLogEntry(data.message || "Task failed.", "error");
            }
        } catch (err) {
            stopPolling();
            setButtonLoading(false);
            const msg = err && err.message ? err.message : "Polling failed";
            showError(msg);
            addLogEntry(msg, "error");
        }
    }, 1200);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function showResult(summary, transcript, segments) {
    $("progressSection").style.display = "none";
    $("resultSection").style.display = "block";
    $("errorSection").style.display = "none";
    currentSummary = summary || "";
    currentTranscript = transcript || "";
    currentSegments = Array.isArray(segments) ? segments : [];
    renderSummary(currentSummary);
}

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function renderSummary(text) {
    const box = $("resultContent");
    if (!box) return;
    const safe = escapeHtml(text || "");

    if (currentFormat === "narrative") {
        box.innerHTML = `<div style="line-height:1.9;">${safe.replace(/\n/g, "<br>")}</div>`;
        return;
    }

    if (currentFormat === "timeline" && currentSegments.length > 0) {
        box.innerHTML = currentSegments
            .map((seg) => {
                const t = formatTime(seg.start || 0);
                return `<div style="margin:8px 0;"><span class="timestamp">[${t}]</span> ${escapeHtml(seg.text || "")}</div>`;
            })
            .join("");
        return;
    }

    if (currentFormat === "mindmap") {
        const rows = safe
            .split("\n")
            .filter(Boolean)
            .map((row) => `└─ ${row}`)
            .join("<br>");
        box.innerHTML = `<div class="mindmap"><div class="root">Summary</div>${rows ? "<br>" + rows : ""}</div>`;
        return;
    }

    box.innerHTML = safe
        .replace(/^##\s*(.+)$/gm, "<h2>$1</h2>")
        .replace(/^- /gm, "• ")
        .replace(/\n/g, "<br>");
}

function switchDepth(depth) {
    currentDepth = depth;
    document.querySelectorAll(".depth-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.depth === depth);
    });
}

function switchFormat(format) {
    currentFormat = format;
    document.querySelectorAll(".format-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.format === format);
    });
    renderSummary(currentSummary);
}

function copyResult() {
    if (!currentSummary) return showToast("Nothing to copy");
    navigator.clipboard.writeText(currentSummary).then(() => showToast("Copied"));
}

function formatTime(seconds) {
    const v = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    const s = Math.floor(v % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatSrtTime(seconds) {
    const v = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    const s = Math.floor(v % 60);
    const ms = Math.round((v % 1) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function buildSrt(segments) {
    if (!segments || segments.length === 0) {
        return "1\n00:00:00,000 --> 00:00:02,000\n(no subtitle)\n";
    }
    return segments
        .map((seg, idx) => {
            const st = formatSrtTime(seg.start || 0);
            const ed = formatSrtTime(seg.end || Number(seg.start || 0) + 2);
            return `${idx + 1}\n${st} --> ${ed}\n${seg.text || ""}\n`;
        })
        .join("\n");
}

function downloadTranscript(type) {
    if (type === "srt") {
        downloadFile("subtitle.srt", buildSrt(currentSegments), "text/plain");
        return;
    }
    const txt = currentTranscript || currentSummary;
    if (!txt) return showToast("Nothing to download");
    downloadFile("transcript.txt", txt, "text/plain");
}

function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function initTheme() {
    const saved = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    const icon = document.querySelector("#themeToggle i");
    if (icon) icon.className = saved === "dark" ? "fas fa-moon" : "fas fa-sun";
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
    const icon = document.querySelector("#themeToggle i");
    if (icon) icon.className = next === "dark" ? "fas fa-moon" : "fas fa-sun";
    if (meshEffect) meshEffect.setTheme(next);
}

class MouseMesh {
    constructor() {
        this.canvas = $("meshCanvas");
        this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
        this.theme = document.documentElement.getAttribute("data-theme") || "dark";
        this.points = [];
        this.maxPoints = this.pickPointCount();
        this.maxDistance = 130;
        this.pointer = { x: 0, y: 0, active: false, vx: 0, vy: 0 };

        if (!this.canvas || !this.ctx) return;
        this.resize();
        this.seedPoints();
        this.bind();
        this.animate();
    }

    pickPointCount() {
        const w = window.innerWidth;
        if (w < 700) return 36;
        if (w < 1200) return 56;
        return 76;
    }

    setTheme(theme) {
        this.theme = theme;
    }

    resize() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.maxPoints = this.pickPointCount();
        if (this.points.length > this.maxPoints) {
            this.points.length = this.maxPoints;
        } else {
            while (this.points.length < this.maxPoints) {
                this.points.push(this.makePoint());
            }
        }
    }

    makePoint() {
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            vx: (Math.random() - 0.5) * 0.35,
            vy: (Math.random() - 0.5) * 0.35,
            radius: 1 + Math.random() * 1.4,
        };
    }

    seedPoints() {
        this.points = [];
        for (let i = 0; i < this.maxPoints; i++) {
            this.points.push(this.makePoint());
        }
    }

    bind() {
        window.addEventListener("resize", () => this.resize());
        window.addEventListener("mousemove", (e) => {
            this.pointer.vx = e.clientX - this.pointer.x;
            this.pointer.vy = e.clientY - this.pointer.y;
            this.pointer.x = e.clientX;
            this.pointer.y = e.clientY;
            this.pointer.active = true;
        });
        window.addEventListener("mouseleave", () => {
            this.pointer.active = false;
        });
    }

    updatePoints() {
        for (const p of this.points) {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x <= 0 || p.x >= this.canvas.width) p.vx *= -1;
            if (p.y <= 0 || p.y >= this.canvas.height) p.vy *= -1;

            p.x = Math.max(0, Math.min(this.canvas.width, p.x));
            p.y = Math.max(0, Math.min(this.canvas.height, p.y));

            if (this.pointer.active) {
                const dx = this.pointer.x - p.x;
                const dy = this.pointer.y - p.y;
                const d = Math.hypot(dx, dy);
                if (d > 1 && d < 180) {
                    const k = (1 - d / 180) * 0.02;
                    p.vx += (dx / d) * k;
                    p.vy += (dy / d) * k;
                }
            }

            p.vx *= 0.992;
            p.vy *= 0.992;
            p.vx = Math.max(-0.9, Math.min(0.9, p.vx));
            p.vy = Math.max(-0.9, Math.min(0.9, p.vy));
        }
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const rgb = this.theme === "light" ? "66, 101, 138" : "216, 228, 240";

        for (let i = 0; i < this.points.length; i++) {
            const a = this.points[i];
            for (let j = i + 1; j < this.points.length; j++) {
                const b = this.points[j];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d > this.maxDistance) continue;
                const alpha = (1 - d / this.maxDistance) * 0.36;
                ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }

        if (this.pointer.active) {
            for (const p of this.points) {
                const d = Math.hypot(p.x - this.pointer.x, p.y - this.pointer.y);
                if (d > 160) continue;
                const alpha = (1 - d / 160) * 0.52;
                ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(this.pointer.x, this.pointer.y);
                ctx.stroke();
            }
        }

        ctx.fillStyle = this.theme === "light" ? "rgba(66,101,138,0.65)" : "rgba(216,228,240,0.6)";
        for (const p of this.points) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    animate() {
        this.updatePoints();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    meshEffect = new MouseMesh();

    const themeBtn = $("themeToggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

    const historyBtn = $("historyToggle");
    const historyPanel = $("historyPanel");
    const historyClose = $("historyClose");
    if (historyBtn && historyPanel) historyBtn.addEventListener("click", () => historyPanel.classList.toggle("show"));
    if (historyClose && historyPanel) historyClose.addEventListener("click", () => historyPanel.classList.remove("show"));

    const infoBtn = $("infoToggle");
    const infoPanel = $("infoPanel");
    const infoClose = $("infoClose");
    if (infoBtn && infoPanel) infoBtn.addEventListener("click", () => infoPanel.classList.toggle("show"));
    if (infoClose && infoPanel) infoClose.addEventListener("click", () => infoPanel.classList.remove("show"));

    const input = $("videoUrl");
    if (input) {
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") startSummarize();
        });
        input.addEventListener("paste", () => {
            setTimeout(() => {
                const url = (input.value || "").trim();
                if (!url) return;
                if (/bilibili\.com|b23\.tv|xiaohongshu\.com|xhslink\.com/i.test(url)) {
                    showToast("Detected video URL, auto start...");
                    startSummarize();
                }
            }, 120);
        });
    }
});
