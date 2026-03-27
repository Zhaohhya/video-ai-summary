let currentTaskId = null;
let pollTimer = null;
let currentDepth = "simple";
let currentFormat = "bullets";
let currentSummary = "";
let currentTranscript = "";
let currentSegments = [];
let lastLogMessage = "";
let mouseTrail = null;

function $(id) {
    return document.getElementById(id);
}

function showToast(text) {
    const toast = $("toast");
    const msg = $("toastMessage");
    if (!toast || !msg) return;
    msg.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
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
    updateProgressText("正在准备任务...");
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

function updateProgressText(text) {
    const detail = $("progressDetail");
    if (!detail) return;
    const span = detail.querySelector("span");
    if (span) span.textContent = text || "处理中...";
}

function setButtonLoading(loading) {
    const btn = $("summarizeBtn");
    if (!btn) return;
    btn.disabled = !!loading;
    btn.innerHTML = loading
        ? '<i class="fas fa-spinner fa-spin"></i><span>处理中...</span>'
        : '<i class="fas fa-play"></i><span>开始总结</span>';
}

function stepByStage(stage) {
    const value = (stage || "").toLowerCase();
    if (value.includes("prepar")) return "step-parse";
    if (value.includes("download")) return "step-download";
    if (value.includes("extract")) return "step-audio";
    if (value.includes("transcrib")) return "step-transcribe";
    if (value.includes("summar")) return "step-summary";
    if (value.includes("complete")) return "step-complete";
    if (value.includes("fail")) return "step-complete";
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
    if (info) info.innerHTML = '<div class="info-empty">正在处理...</div>';
    if (log) log.innerHTML = '<div class="log-empty">等待开始...</div>';
    lastLogMessage = "";
}

function updateInfoPanel(data) {
    const info = $("infoContent");
    if (!info) return;
    const timing = data.timing || {};
    const token = data.token_usage;

    const items = [];
    if (timing.download !== undefined) items.push(["下载耗时", `${timing.download}s`]);
    if (timing.audio_extract !== undefined) items.push(["提取音频", `${timing.audio_extract}s`]);
    if (timing.transcribe !== undefined) items.push(["转写耗时", `${timing.transcribe}s`]);
    if (timing.summarize !== undefined) items.push(["总结耗时", `${timing.summarize}s`]);
    if (timing.total !== undefined) items.push(["总耗时", `${timing.total}s`]);
    if (token !== null && token !== undefined) items.push(["输出Token", `${token}`]);

    if (items.length === 0) {
        info.innerHTML = '<div class="info-empty">处理中，暂无统计数据</div>';
        return;
    }

    info.innerHTML = items
        .map(
            ([k, v]) =>
                `<div class="info-item"><span class="info-item-label">${escapeHtml(k)}</span><span class="info-item-value">${escapeHtml(v)}</span></div>`
        )
        .join("");
}

function addLogEntry(message, type = "info") {
    if (!message || message === lastLogMessage) return;
    lastLogMessage = message;

    const log = $("logContent");
    if (!log) return;
    const empty = log.querySelector(".log-empty");
    if (empty) empty.remove();

    const now = new Date();
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(
        now.getSeconds()
    ).padStart(2, "0")}`;
    const row = document.createElement("div");
    row.className = `log-entry ${type}`;
    row.innerHTML = `<span class="log-time">[${t}]</span> ${escapeHtml(message)}`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
}

async function startSummarize() {
    const url = ($("videoUrl").value || "").trim();
    if (!url) {
        showError("请输入视频链接。");
        return;
    }

    hideError();
    resetSteps();
    showProgress();
    clearInfoPanel();
    setButtonLoading(true);
    addLogEntry("任务已提交，等待后端响应。");
    markStep("preparing");

    try {
        const resp = await fetch("/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, depth: currentDepth }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || "请求失败");
        currentTaskId = data.task_id;
        addLogEntry(`任务创建成功: ${currentTaskId}`);
        startPolling();
    } catch (err) {
        setButtonLoading(false);
        showError(err.message || "请求失败");
        addLogEntry(err.message || "请求失败", "error");
    }
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
        if (!currentTaskId) return;
        try {
            const resp = await fetch(`/api/status/${currentTaskId}`);
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || "状态查询失败");

            updateProgressText(data.message || "处理中...");
            updateInfoPanel(data);
            markStep(data.stage, data.status === "completed");
            addLogEntry(data.message || data.stage || "状态更新");

            if (data.status === "completed") {
                stopPolling();
                setButtonLoading(false);
                showResult(data.result, data.transcript, data.segments);
                addLogEntry("任务完成。", "success");
                showToast("处理完成");
            } else if (data.status === "failed") {
                stopPolling();
                setButtonLoading(false);
                showError(data.message || "处理失败");
                addLogEntry(data.message || "处理失败", "error");
            }
        } catch (err) {
            stopPolling();
            setButtonLoading(false);
            showError(err.message || "轮询失败");
            addLogEntry(err.message || "轮询失败", "error");
        }
    }, 1200);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
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
        const lines = currentSegments.map((seg) => {
            const t = formatTime(seg.start || 0);
            return `<div style="margin:8px 0;"><span class="timestamp">[${t}]</span> ${escapeHtml(seg.text || "")}</div>`;
        });
        box.innerHTML = lines.join("");
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
    const text = currentSummary || "";
    if (!text) return showToast("暂无可复制内容");
    navigator.clipboard.writeText(text).then(() => showToast("已复制"));
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
    if (!segments || segments.length === 0) return "1\n00:00:00,000 --> 00:00:02,000\n(无字幕)\n";
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
        const srt = buildSrt(currentSegments);
        downloadFile("subtitle.srt", srt, "text/plain");
        return;
    }
    const txt = currentTranscript || currentSummary;
    if (!txt) return showToast("暂无可下载内容");
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
    if (mouseTrail) mouseTrail.setTheme(next);
}

class MouseTrail {
    constructor() {
        this.canvas = $("mouseCanvas");
        this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
        this.particles = [];
        this.theme = document.documentElement.getAttribute("data-theme") || "dark";
        this.mouse = { x: 0, y: 0, active: false };
        this.frame = null;

        if (!this.canvas || !this.ctx) return;
        this.resize();
        this.bind();
        this.animate();
    }

    setTheme(theme) {
        this.theme = theme;
    }

    resize() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    bind() {
        window.addEventListener("resize", () => this.resize());
        window.addEventListener("mousemove", (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            this.mouse.active = true;
            this.spawn(e.clientX, e.clientY);
        });
        window.addEventListener("mouseleave", () => {
            this.mouse.active = false;
        });
    }

    spawn(x, y) {
        for (let i = 0; i < 2; i++) {
            this.particles.push({
                x,
                y,
                vx: (Math.random() - 0.5) * 1.4,
                vy: (Math.random() - 0.5) * 1.4,
                life: 1,
                size: 1.2 + Math.random() * 2.2,
            });
        }
    }

    animate() {
        if (!this.canvas || !this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.025;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            const color =
                this.theme === "light"
                    ? `rgba(66, 101, 138, ${p.life.toFixed(3)})`
                    : `rgba(216, 228, 240, ${p.life.toFixed(3)})`;
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.frame = requestAnimationFrame(() => this.animate());
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    mouseTrail = new MouseTrail();

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
                    showToast("检测到视频链接，自动开始总结");
                    startSummarize();
                }
            }, 120);
        });
    }
});
