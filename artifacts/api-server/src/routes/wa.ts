import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { getBotInfo, requestPairingCode } from "../bot";
import { allCommands } from "../bot/commands";
import { BOT_NAME, OWNER_NUMBER } from "../bot/utils";

const router: Router = Router();

const ownerImagePath = path.resolve(process.cwd(), "assets", "owner.jpg");

router.get("/owner.jpg", (_req, res) => {
  if (!fs.existsSync(ownerImagePath)) {
    res.status(404).send("not found");
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.sendFile(ownerImagePath);
});

router.get("/status", (_req, res) => {
  res.json({
    bot: BOT_NAME,
    owner: OWNER_NUMBER,
    ...getBotInfo(),
    commands: allCommands.map((c) => ({
      name: c.name,
      desc: c.desc,
      category: c.category,
    })),
  });
});

router.post("/reset", async (_req, res) => {
  try {
    const authDir = path.resolve(process.cwd(), ".wa-state", "auth");
    fs.rmSync(authDir, { recursive: true, force: true });
    res.json({ ok: true, message: "auth wiped, bot will restart with fresh state" });
    // hard-restart the process so a clean Baileys socket is created
    setTimeout(() => process.exit(0), 250);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/pair", async (req, res) => {
  try {
    const phone = String(req.body?.phone ?? "");
    if (!phone) {
      res.status(400).json({ error: "phone required" });
      return;
    }
    const code = await requestPairingCode(phone);
    res.json({ code });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${BOT_NAME} — Link your WhatsApp</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<base href="/api/wa/" />
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:linear-gradient(180deg,#0b141a,#06090c);color:#e9edef;margin:0;min-height:100vh;padding:24px;display:flex;align-items:center;justify-content:center;}
  .card{width:100%;max-width:520px;background:#111b21;border:1px solid #2a3942;border-radius:18px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.4);}
  .header{text-align:center;margin-bottom:20px;}
  h1{margin:0;color:#25d366;font-size:28px;letter-spacing:.5px;}
  .sub{color:#8696a0;font-size:14px;margin-top:4px;}
  .owner{display:flex;align-items:center;gap:12px;justify-content:center;margin:18px 0;padding:12px;background:#202c33;border-radius:12px;}
  .owner img{width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #25d366;}
  .pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;}
  .pill.open{background:#25d366;color:#0b141a;}
  .pill.closed{background:#f15c6d;color:#fff;}
  .pill.connecting{background:#ffb454;color:#0b141a;}
  label{display:block;text-align:left;font-size:13px;color:#8696a0;margin:14px 0 6px;}
  .row{display:flex;gap:8px;}
  input{flex:1;font:inherit;padding:12px 14px;border-radius:10px;border:1px solid #2a3942;background:#202c33;color:#e9edef;font-size:16px;outline:none;}
  input:focus{border-color:#25d366;}
  .btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;}
  button{font:inherit;padding:13px 16px;border-radius:10px;border:none;background:#25d366;color:#0b141a;font-weight:700;cursor:pointer;font-size:15px;}
  button.alt{background:#2a3942;color:#e9edef;}
  button:disabled{opacity:.6;cursor:not-allowed;}
  .result{margin-top:22px;padding:18px;background:#0b141a;border:1px dashed #2a3942;border-radius:12px;text-align:center;min-height:60px;}
  .code{font-size:38px;letter-spacing:8px;color:#25d366;font-weight:800;font-family:'SF Mono',Menlo,monospace;}
  .qr{background:#fff;padding:14px;border-radius:12px;display:inline-block;}
  .qr img{display:block;width:240px;height:240px;}
  .err{color:#f15c6d;font-size:14px;}
  .help{margin-top:16px;padding:12px;background:#1a2730;border-radius:10px;text-align:left;font-size:13px;color:#aebac1;line-height:1.55;}
  .help b{color:#e9edef;}
  small{color:#8696a0;}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>${BOT_NAME}</h1>
    <div class="sub">Link any WhatsApp number to the bot</div>
  </div>

  <div class="owner">
    <img src="owner.jpg" alt="" />
    <div style="text-align:left">
      <div><b>Bot status</b></div>
      <div>Status: <span id="status" class="pill connecting">…</span> <span id="user" style="color:#8696a0;font-size:12px"></span></div>
    </div>
  </div>

  <label for="phone">WhatsApp number (international format, no <code>+</code>)</label>
  <div class="row">
    <input id="phone" inputmode="numeric" placeholder="e.g. 256752233886" value="${OWNER_NUMBER}" />
  </div>
  <div class="btns">
    <button id="btnPair">Get pairing code</button>
    <button id="btnQR" class="alt">Show QR code</button>
  </div>
  <div style="margin-top:10px;text-align:center;">
    <button id="btnReset" class="alt" style="font-size:13px;padding:8px 14px;">⟲ Reset session (clear auth & restart)</button>
  </div>

  <div class="result" id="result">
    <small>Enter your number, then choose a method.</small>
  </div>

  <div class="help">
    <b>How to link:</b><br/>
    1. Open WhatsApp on the phone you want to link.<br/>
    2. Go to <b>Settings → Linked Devices → Link a Device</b>.<br/>
    3. Tap <b>"Link with phone number instead"</b> and enter the 8-character code shown above — or tap "Link with QR" and scan the QR image.<br/>
    4. The code expires in ~60 seconds. If it fails, click <b>Get pairing code</b> again.
  </div>
  <p style="text-align:center;margin-top:14px"><small>Prefixes: <b>.</b> &nbsp; <b>%</b> &nbsp; <b>✨️</b> &nbsp; <b>!</b></small></p>
</div>

<script>
const $ = (id) => document.getElementById(id);
const result = $("result");
const statusEl = $("status");
const userEl = $("user");
const btnPair = $("btnPair");
const btnQR = $("btnQR");
const btnReset = $("btnReset");

btnReset.onclick = async () => {
  if (!confirm("Wipe the saved WhatsApp session and restart? You will need to re-link.")) return;
  btnReset.disabled = true; btnReset.textContent = "Resetting…";
  result.dataset.userAction = "1"; lastShownCode = "";
  try {
    await fetch("reset", { method: "POST" });
    result.innerHTML = '<small>Session wiped. The bot is restarting — wait ~15 seconds for a fresh code to appear automatically.</small>';
  } catch {
    result.innerHTML = '<small>Reset signal sent. The bot is restarting — wait ~15 seconds.</small>';
  }
  setTimeout(() => { delete result.dataset.userAction; btnReset.disabled = false; btnReset.textContent = "⟲ Reset session (clear auth & restart)"; }, 20000);
};
const phoneInput = $("phone");

function fmtCode(c) {
  if (!c) return "";
  return c.length === 8 ? c.slice(0,4) + "-" + c.slice(4) : c;
}

let lastShownCode = "";
async function refreshStatus() {
  try {
    const r = await fetch("status").then(r => r.json());
    statusEl.textContent = r.state.toUpperCase();
    statusEl.className = "pill " + r.state;
    userEl.textContent = r.user ? "(" + r.user + ")" : "";
    if (r.state === "open") {
      result.innerHTML = '<div style="color:#25d366;font-weight:600;font-size:18px">✓ Linked successfully</div><small>You can close this page. Send <b>.menu</b> to the bot to see commands.</small>';
      btnPair.disabled = true; btnQR.disabled = true;
      return;
    }
    // Auto-display the bot's auto-generated pairing code if available and not already shown
    if (r.pairingCode && r.pairingCode !== lastShownCode && !result.dataset.userAction) {
      lastShownCode = r.pairingCode;
      result.innerHTML = '<div><small>Pairing code for the bot owner number</small></div><div class="code">' + fmtCode(r.pairingCode) + '</div><small>Open WhatsApp on +' + (r.owner || '') + ', go to Linked Devices → Link a device → Link with phone number, and enter this code within ~60s.</small>';
    }
  } catch {}
}

btnPair.onclick = async () => {
  const phone = phoneInput.value.replace(/\\D/g, "");
  if (phone.length < 8) { result.innerHTML = '<span class="err">Enter a valid phone number with country code.</span>'; return; }
  result.dataset.userAction = "1";
  btnPair.disabled = true; btnPair.textContent = "Requesting…";
  result.innerHTML = '<small>Asking WhatsApp for a code… (this can take 10-20s)</small>';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const resp = await fetch("pair", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ phone }), signal: ctrl.signal });
    clearTimeout(t);
    const r = await resp.json();
    if (r.code) {
      lastShownCode = r.code;
      result.innerHTML = '<div><small>Pairing code for +' + phone + '</small></div><div class="code">' + fmtCode(r.code) + '</div><small>Enter this in WhatsApp within 60 seconds.</small>';
    } else {
      result.innerHTML = '<span class="err">' + (r.error || "Failed") + '</span>';
    }
  } catch (e) {
    result.innerHTML = '<span class="err">Network error: ' + (e.message || e) + '. The bot may still be connecting — wait for status to be CONNECTING then try again, or use QR.</span>';
  } finally {
    btnPair.disabled = false; btnPair.textContent = "Get pairing code";
    setTimeout(() => { delete result.dataset.userAction; }, 8000);
  }
};

btnQR.onclick = async () => {
  result.innerHTML = '<small>Loading QR…</small>';
  try {
    const r = await fetch("status").then(r => r.json());
    if (r.qrDataUrl) {
      result.innerHTML = '<div class="qr"><img src="' + r.qrDataUrl + '" alt="QR"/></div><div><small>Open WhatsApp → Linked Devices → Link a Device, then scan.</small></div>';
    } else if (r.state === "open") {
      result.innerHTML = '<small>Already linked.</small>';
    } else {
      result.innerHTML = '<small>QR not ready yet, try again in a few seconds.</small>';
    }
  } catch (e) {
    result.innerHTML = '<span class="err">' + e.message + '</span>';
  }
};

refreshStatus();
setInterval(refreshStatus, 4000);
</script>
</body>
</html>`);
});

export default router;
