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

/* ── Spatial grid for fast neighbor lookup ── */
class SpatialGrid {
    constructor(cellSize, w, h) {
        this.cellSize = cellSize;
        this.cols = Math.ceil(w / cellSize) || 1;
        this.rows = Math.ceil(h / cellSize) || 1;
        this.cells = new Array(this.cols * this.rows);
    }
    clear() {
        for (let i = 0; i < this.cells.length; i++) this.cells[i] = null;
    }
    insert(p) {
        const c = Math.min(this.cols - 1, Math.max(0, (p.x / this.cellSize) | 0));
        const r = Math.min(this.rows - 1, Math.max(0, (p.y / this.cellSize) | 0));
        const idx = r * this.cols + c;
        p._next = this.cells[idx];
        this.cells[idx] = p;
    }
    forEachPair(maxDist, cb) {
        const cols = this.cols, cells = this.cells;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                // pairs within same cell
                for (let a = cells[idx]; a; a = a._next) {
                    for (let b = a._next; b; b = b._next) {
                        const d = Math.hypot(a.x - b.x, a.y - b.y);
                        if (d < maxDist) cb(a, b, d);
                    }
                    // pairs with right / bottom / bottom-right / bottom-left neighbors
                    const neighbors = [
                        c + 1 < cols ? idx + 1 : -1,
                        r + 1 < this.rows ? idx + cols : -1,
                        c + 1 < cols && r + 1 < this.rows ? idx + cols + 1 : -1,
                        c - 1 >= 0 && r + 1 < this.rows ? idx + cols - 1 : -1,
                    ];
                    for (const ni of neighbors) {
                        if (ni < 0) continue;
                        for (let b = cells[ni]; b; b = b._next) {
                            const d = Math.hypot(a.x - b.x, a.y - b.y);
                            if (d < maxDist) cb(a, b, d);
                        }
                    }
                }
            }
        }
    }
}

/* ── Color palettes ── */
const PALETTES = {
    dark: {
        nodeCore: [216, 228, 240],
        glowHsl: "210,60%,80%",
        lineHueBase: 210,
        lineHueRange: 25,
        lineSat: 55,
        lineLight: 80,
        trailHsl: "205,50%,88%",
        auroraAlpha: 0.30,
        auroraHues: [210, 195, 225],
    },
    light: {
        nodeCore: [66, 101, 138],
        glowHsl: "210,50%,55%",
        lineHueBase: 215,
        lineHueRange: 20,
        lineSat: 45,
        lineLight: 42,
        trailHsl: "210,50%,45%",
        auroraAlpha: 0.18,
        auroraHues: [210, 200, 230],
    },
};

/* ── Aurora ambient glow layer ── */
class AuroraLayer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext("2d") : null;
        this.blobs = [
            { cx: 0.30, cy: 0.40, r: 0.35, hueIdx: 0, fX: 0.00030, fY: 0.00020, pX: 0, pY: 1.2 },
            { cx: 0.70, cy: 0.60, r: 0.30, hueIdx: 1, fX: 0.00020, fY: 0.00035, pX: 2.1, pY: 0 },
            { cx: 0.50, cy: 0.30, r: 0.25, hueIdx: 2, fX: 0.00025, fY: 0.00015, pX: 0.8, pY: 3.0 },
        ];
        this.frame = 0;
    }
    resize(w, h, dpr) {
        if (!this.canvas) return;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.w = w;
        this.h = h;
    }
    draw(time, pal) {
        this.frame++;
        if (this.frame % 3 !== 0) return; // throttle to every 3rd frame
        const ctx = this.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, this.w, this.h);
        ctx.globalCompositeOperation = "lighter";
        const hues = pal.auroraHues;
        const alpha = pal.auroraAlpha;
        for (const b of this.blobs) {
            const x = (b.cx + 0.15 * Math.sin(time * b.fX + b.pX)) * this.w;
            const y = (b.cy + 0.15 * Math.sin(time * b.fY + b.pY)) * this.h;
            const r = b.r * Math.min(this.w, this.h);
            const hue = hues[b.hueIdx];
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, `hsla(${hue},50%,70%,${(alpha).toFixed(2)})`);
            g.addColorStop(0.5, `hsla(${hue},40%,60%,${(alpha * 0.35).toFixed(3)})`);
            g.addColorStop(1, `hsla(${hue},30%,50%,0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.globalCompositeOperation = "source-over";
    }
}

/* ── Mouse trail layer ── */
class MouseTrailLayer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext("2d") : null;
        this.trail = [];
        this.maxAge = 900;
        this.maxLen = 40;
    }
    resize(w, h, dpr) {
        if (!this.canvas) return;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.w = w;
        this.h = h;
    }
    addPoint(x, y, time) {
        this.trail.push({ x, y, birth: time });
        if (this.trail.length > this.maxLen) this.trail.shift();
    }
    draw(time, pal) {
        const ctx = this.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, this.w, this.h);
        if (this.trail.length === 0) return;

        ctx.globalCompositeOperation = "lighter";
        const hsl = pal.trailHsl;
        let alive = 0;
        for (const pt of this.trail) {
            const age = time - pt.birth;
            if (age > this.maxAge) continue;
            alive++;
            const life = 1 - age / this.maxAge;
            const r = 2.5 + 4 * life;
            const a = life * life;
            ctx.shadowBlur = r * 3.5;
            ctx.shadowColor = `hsla(${hsl},${(a * 0.55).toFixed(3)})`;
            ctx.fillStyle = `hsla(${hsl},${(a * 0.75).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = "source-over";

        if (alive === 0) this.trail.length = 0;
    }
}

/* ── Main constellation layer ── */
class ConstellationLayer {
    constructor(canvas, pointer) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext("2d") : null;
        this.pointer = pointer;
        this.points = [];
        this.maxDist = 140;
        this.grid = null;
        this.lastSpawnAt = 0;
        this.spawnInterval = 900;
        this.isMobile = window.innerWidth < 700 || "ontouchstart" in window;
    }
    pickCount() {
        const w = window.innerWidth;
        if (w < 700) return 36;
        if (w < 1200) return 56;
        return 76;
    }
    resize(w, h, dpr) {
        if (!this.canvas) return;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.w = w;
        this.h = h;
        this.isMobile = w < 700 || "ontouchstart" in window;
        this.maxDist = this.isMobile ? 105 : 140;
        const target = this.pickCount();
        while (this.points.length > target) this.points.pop();
        while (this.points.length < target) this.points.push(this.makePoint());
    }
    makePoint() {
        const TAU = Math.PI * 2;
        const depthRoll = Math.random();
        const depthLayer = depthRoll < 0.50 ? 0 : depthRoll < 0.85 ? 1 : 2;
        const depthScale = [0.50, 0.75, 1.0][depthLayer];
        return {
            x: Math.random() * (this.w || window.innerWidth),
            y: Math.random() * (this.h || window.innerHeight),
            vx: (Math.random() - 0.5) * 0.3 * depthScale,
            vy: (Math.random() - 0.5) * 0.3 * depthScale,
            baseRadius: (0.8 + Math.random() * 1.4) * depthScale,
            depthLayer,
            depthScale,
            alphaMul: [0.5, 0.78, 1.0][depthLayer],
            colorOffset: Math.random() * 30,
            phase: Math.random() * TAU,
            stick: 0,
            life: 0,
            ttl: 360 + Math.floor(Math.random() * 420),
            _next: null,
        };
    }
    seed() {
        this.points = [];
        const n = this.pickCount();
        for (let i = 0; i < n; i++) this.points.push(this.makePoint());
    }
    maybeRespawn(now) {
        if (now - this.lastSpawnAt < this.spawnInterval) return;
        this.lastSpawnAt = now;
        this.spawnInterval = 700 + Math.random() * 1200;
        const count = 1 + (Math.random() > 0.84 ? 1 : 0);
        for (let i = 0; i < count && this.points.length > 0; i++) {
            const idx = Math.floor(Math.random() * this.points.length);
            Object.assign(this.points[idx], this.makePoint());
        }
    }
    update(time) {
        const ptr = this.pointer;
        const now = performance.now();
        if (now - ptr.lastMoveAt > 120) {
            ptr.speed *= 0.8;
            ptr.vx *= 0.82;
            ptr.vy *= 0.82;
        }
        const slowF = Math.max(0, Math.min(1, 1 - ptr.speed / 16));
        const fastF = Math.max(0, Math.min(1, (ptr.speed - 14) / 20));

        this.maybeRespawn(now);

        for (const p of this.points) {
            p.life++;
            if (p.life > p.ttl) Object.assign(p, this.makePoint());

            p.x += p.vx;
            p.y += p.vy;
            if (p.x <= 0 || p.x >= this.w) p.vx *= -1;
            if (p.y <= 0 || p.y >= this.h) p.vy *= -1;
            p.x = Math.max(0, Math.min(this.w, p.x));
            p.y = Math.max(0, Math.min(this.h, p.y));

            if (ptr.active) {
                const dx = ptr.x - p.x, dy = ptr.y - p.y;
                const d = Math.hypot(dx, dy);
                const ir = 210 * p.depthScale;
                if (d > 1 && d < ir) {
                    const nx = dx / d, ny = dy / d, inf = 1 - d / ir;
                    if (slowF > 0) {
                        const a = inf * (0.012 + 0.08 * slowF + 0.05 * p.stick);
                        p.vx += nx * a + ptr.vx * 0.003 * inf;
                        p.vy += ny * a + ptr.vy * 0.003 * inf;
                        p.stick = Math.min(1, p.stick + 0.04 * inf * slowF);
                    }
                    if (fastF > 0) {
                        const t = inf * (0.035 + 0.18 * fastF);
                        p.vx -= nx * t;
                        p.vy -= ny * t;
                        p.stick = Math.max(0, p.stick - 0.14 * fastF);
                    }
                }
            } else {
                p.stick = Math.max(0, p.stick - 0.02);
            }

            const damp = fastF > 0.4 ? 0.972 : 0.988;
            p.vx *= damp;
            p.vy *= damp;
            p.vx = Math.max(-1.8, Math.min(1.8, p.vx));
            p.vy = Math.max(-1.8, Math.min(1.8, p.vy));
        }
    }
    draw(time, pal) {
        const ctx = this.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, this.w, this.h);
        const ptr = this.pointer;
        const mobile = this.isMobile;

        const breathGlobal = 0.88 + 0.12 * Math.sin(time * 0.0008);
        const [cr, cg, cb] = pal.nodeCore;
        const hBase = pal.lineHueBase;
        const hRange = pal.lineHueRange;
        const lSat = pal.lineSat;
        const lLight = pal.lineLight;

        // Build spatial grid
        this.grid = new SpatialGrid(this.maxDist, this.w, this.h);
        this.grid.clear();
        for (const p of this.points) this.grid.insert(p);

        // Draw connections
        this.grid.forEachPair(this.maxDist, (a, b, d) => {
            if (Math.abs(a.depthLayer - b.depthLayer) > 1) return;
            const minDepth = Math.min(a.depthScale, b.depthScale);
            const breathA = 0.88 + 0.12 * Math.sin(time * 0.0008 + a.phase);
            const breathB = 0.88 + 0.12 * Math.sin(time * 0.0008 + b.phase);
            const breathAvg = (breathA + breathB) * 0.5;
            const baseAlpha = (1 - d / this.maxDist) * 0.6 * minDepth * breathAvg;
            if (baseAlpha < 0.02) return;

            if (baseAlpha > 0.12 && !mobile) {
                const hA = hBase + a.colorOffset * hRange / 30;
                const hB = hBase + b.colorOffset * hRange / 30;
                const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
                g.addColorStop(0, `hsla(${hA},${lSat}%,${lLight}%,${baseAlpha.toFixed(3)})`);
                g.addColorStop(1, `hsla(${hB},${lSat}%,${lLight}%,${baseAlpha.toFixed(3)})`);
                ctx.strokeStyle = g;
            } else {
                ctx.strokeStyle = `rgba(${cr},${cg},${cb},${baseAlpha.toFixed(3)})`;
            }
            ctx.lineWidth = 0.5 + 0.5 * (1 - d / this.maxDist) * minDepth;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        });

        // Draw cursor connections
        if (ptr.active) {
            const fastF = Math.max(0, Math.min(1, (ptr.speed - 14) / 20));
            for (const p of this.points) {
                const d = Math.hypot(p.x - ptr.x, p.y - ptr.y);
                if (d > 200) continue;
                const prox = 1 - d / 200;
                const sb = p.stick * 0.35;
                const alphaBase = prox * (0.35 + sb) * p.alphaMul;
                const alpha = Math.max(0.04, alphaBase * (1 - fastF * 0.5));
                if (!mobile) {
                    const h = hBase + p.colorOffset * hRange / 30;
                    const g = ctx.createLinearGradient(p.x, p.y, ptr.x, ptr.y);
                    g.addColorStop(0, `hsla(${h},${lSat + 15}%,${lLight + 5}%,${(alpha * 0.9).toFixed(3)})`);
                    g.addColorStop(1, `hsla(${h},${lSat}%,${Math.min(95, lLight + 15)}%,${(alpha * 0.2).toFixed(3)})`);
                    ctx.strokeStyle = g;
                } else {
                    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
                }
                ctx.lineWidth = 0.9 + prox * 1.2 + p.stick * 0.6;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(ptr.x, ptr.y);
                ctx.stroke();
            }
        }

        // Draw glowing nodes
        if (!mobile) ctx.shadowColor = `hsla(${pal.glowHsl},0.6)`;
        for (const p of this.points) {
            const breath = 0.88 + 0.12 * Math.sin(time * 0.0008 + p.phase);
            const r = p.baseRadius * breath;
            const a = p.alphaMul * breath * breathGlobal;
            if (a < 0.04) continue;

            // proximity glow boost
            let glowBoost = 1;
            if (ptr.active) {
                const d = Math.hypot(p.x - ptr.x, p.y - ptr.y);
                if (d < 200) glowBoost = 1 + (1 - d / 200) * 1.8;
            }

            if (!mobile) {
                ctx.shadowBlur = r * 3 * glowBoost;
            }
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${(a * 0.95).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }
}

/* ── Orchestrator ── */
class FlowingConstellation {
    constructor() {
        this.theme = document.documentElement.getAttribute("data-theme") || "dark";
        this.palette = PALETTES[this.theme] || PALETTES.dark;
        this.pointer = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false, lastMoveAt: 0 };
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);

        this.aurora = new AuroraLayer($("auroraCanvas"));
        this.trail = new MouseTrailLayer($("mouseCanvas"));
        this.constellation = new ConstellationLayer($("meshCanvas"), this.pointer);

        if (!this.constellation.canvas) return;
        this.resize();
        this.constellation.seed();
        this.bind();
        this.animate();
    }
    setTheme(theme) {
        this.theme = theme;
        this.palette = PALETTES[theme] || PALETTES.dark;
    }
    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.aurora.resize(w, h, this.dpr);
        this.trail.resize(w, h, this.dpr);
        this.constellation.resize(w, h, this.dpr);
    }
    bind() {
        window.addEventListener("resize", () => this.resize());
        window.addEventListener("mousemove", (e) => {
            this.pointer.vx = e.clientX - this.pointer.x;
            this.pointer.vy = e.clientY - this.pointer.y;
            this.pointer.x = e.clientX;
            this.pointer.y = e.clientY;
            this.pointer.speed = Math.hypot(this.pointer.vx, this.pointer.vy);
            this.pointer.active = true;
            this.pointer.lastMoveAt = performance.now();
            this.trail.addPoint(e.clientX, e.clientY, performance.now());
        });
        window.addEventListener("mouseleave", () => { this.pointer.active = false; });
    }
    animate() {
        const t = performance.now();
        const pal = this.palette;
        this.aurora.draw(t, pal);
        this.constellation.update(t);
        this.constellation.draw(t, pal);
        this.trail.draw(t, pal);
        requestAnimationFrame(() => this.animate());
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    meshEffect = new FlowingConstellation();

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
