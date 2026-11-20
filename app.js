"use strict";
(function () {
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const SKEY = "auc_session";
  let sess = null, role = null, myEmail = "", items = [], members = [];
  const f = { status: "stock", q: "", acct: "", sort: "win_date", dir: -1 };
  let cur = null, confirmFn = null;

  const money = (n) => (n == null || isNaN(n)) ? "-" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (v) => { if (v === "" || v == null) return null; const n = Number(v); return isNaN(n) ? null : n; };
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const estCost = (h) => Math.round(h * 1.15 * 1.0825 * 100) / 100;
  const cost = (i) => i.all_in_cost != null ? Number(i.all_in_cost) : estCost(Number(i.winning_bid));
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === "class") e.className = attrs[k]; else if (k === "text") e.textContent = attrs[k];
      else if (k.startsWith("data-")) e.setAttribute(k, attrs[k]); else e[k] = attrs[k];
    }
    kids.flat().forEach((c) => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 3200); }
  function show(id) { ["v-login", "v-setpw", "v-mfa", "v-noaccess", "v-app"].forEach((v) => $(v).hidden = v !== id); }
  function jwt(t) { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return {}; } }
  const safeUrl = (u, hosts) => { try { const x = new URL(u); return x.protocol === "https:" && hosts.some((h) => x.hostname === h || x.hostname.endsWith("." + h)) ? x.href : null; } catch (e) { return null; } };
  const AMZ = ["amazon.com", "a.co", "amzn.to"];
  const IMG = ["m.media-amazon.com", "images-na.ssl-images-amazon.com", "storage.googleapis.com", "images.nellisauction.com"];

  async function http(path, opts = {}, auth = true) {
    if (auth) await ensureFresh();
    const h = Object.assign({ apikey: CFG.key, "Content-Type": "application/json" }, opts.headers || {});
    h.Authorization = "Bearer " + (auth && sess ? sess.access_token : CFG.key);
    const r = await fetch(CFG.url + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const txt = await r.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (!r.ok) { const m = (data && (data.msg || data.message || data.error_description || data.error)) || ("HTTP " + r.status); const e = new Error(m); e.status = r.status; throw e; }
    return data;
  }
  function saveSess(s) { sess = s; if (s) { if (!s.expires_at) s.expires_at = Math.floor(Date.now() / 1000) + (s.expires_in || 3600); localStorage.setItem(SKEY, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at })); } else localStorage.removeItem(SKEY); }
  async function ensureFresh() {
    if (!sess) return;
    if (sess.expires_at - 60 > Date.now() / 1000) return;
    const r = await fetch(CFG.url + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: CFG.key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: sess.refresh_token }) });
    if (!r.ok) { saveSess(null); location.reload(); throw new Error("Session expired"); }
    saveSess(await r.json());
  }
  const rpc = (fn, args) => http("/rest/v1/rpc/" + fn, { method: "POST", body: args || {} });

  async function start() {
    document.addEventListener("click", onClick);
    $("f-login").addEventListener("submit", doLogin);
    $("f-setpw").addEventListener("submit", doSetPw);
    $("f-mfa").addEventListener("submit", doMfa);
    $("q").addEventListener("input", (e) => { f.q = e.target.value.toLowerCase(); render(); });
    $("acct").addEventListener("change", (e) => { f.acct = e.target.value; render(); });
    $("sortSel").addEventListener("change", (e) => { f.sort = e.target.value; render(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && role) loadItems(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (hash.get("access_token")) {
      const type = hash.get("type");
      saveSess({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"), expires_at: Number(hash.get("expires_at")) || undefined, expires_in: Number(hash.get("expires_in")) || 3600 });
      history.replaceState(null, "", location.pathname);
      if (type === "invite" || type === "recovery") { show("v-setpw"); return; }
    } else {
      try { const s = JSON.parse(localStorage.getItem(SKEY) || "null"); if (s) sess = s; } catch (e) {}
    }
    if (!sess) { show("v-login"); return; }
    try { await afterSignIn(); } catch (e) { saveSess(null); show("v-login"); $("l-err").textContent = e.message; }
  }
  async function doLogin(ev) {
    ev.preventDefault(); $("l-err").textContent = ""; $("l-go").disabled = true;
    try {
      const s = await http("/auth/v1/token?grant_type=password", { method: "POST", body: { email: $("l-email").value.trim(), password: $("l-pass").value } }, false);
      saveSess(s); $("l-pass").value = ""; await afterSignIn();
    } catch (e) { $("l-err").textContent = e.message === "Invalid login credentials" ? "Wrong email or password." : e.message; }
    $("l-go").disabled = false;
  }
  async function doSetPw(ev) {
    ev.preventDefault(); const a = $("p-new").value, b = $("p-new2").value; const er = $("p-err"); er.textContent = "";
    if (a.length < 12) { er.textContent = "Use at least 12 characters."; return; }
    if (a !== b) { er.textContent = "Passwords do not match."; return; }
    try { await http("/auth/v1/user", { method: "PUT", body: { password: a } }); toast("Password saved"); await afterSignIn(); } catch (e) { er.textContent = e.message; }
  }
  let mfa = { factorId: null, challengeId: null };
  async function afterSignIn() {
    const claims = jwt(sess.access_token); myEmail = claims.email || "";
    if (claims.aal !== "aal2") { await beginMfa(); return; }
    await enter();
  }
  async function beginMfa() {
    const u = await http("/auth/v1/user");
    const fac = (u.factors || []).find((x) => x.factor_type === "totp" && x.status === "verified");
    show("v-mfa"); $("m-err").textContent = ""; $("m-code").value = "";
    if (fac) {
      mfa.factorId = fac.id; $("m-enroll").hidden = true; $("m-title").textContent = "Verification code";
      $("m-ask").textContent = "Enter the 6 digit code from your authenticator app.";
    } else {
      for (const x of (u.factors || [])) { if (x.status !== "verified") { try { await http("/auth/v1/factors/" + x.id, { method: "DELETE" }); } catch (e) {} } }
      const en = await http("/auth/v1/factors", { method: "POST", body: { factor_type: "totp", friendly_name: "Authenticator " + Date.now() } });
      mfa.factorId = en.id; $("m-enroll").hidden = false; $("m-title").textContent = "Set up two-step sign in";
      $("m-qr").src = en.totp.qr_code; $("m-secret").textContent = en.totp.secret;
      $("m-ask").textContent = "Then enter the 6 digit code the app shows.";
    }
    $("m-code").focus();
  }
  async function doMfa(ev) {
    ev.preventDefault(); $("m-err").textContent = "";
    try {
      const ch = await http("/auth/v1/factors/" + mfa.factorId + "/challenge", { method: "POST", body: {} });
      const s = await http("/auth/v1/factors/" + mfa.factorId + "/verify", { method: "POST", body: { challenge_id: ch.id, code: $("m-code").value.trim() } });
      saveSess(s); await enter();
    } catch (e) { $("m-err").textContent = "Code not accepted. Try the next code."; $("m-code").value = ""; }
  }
  async function enter() {
    const claims = jwt(sess.access_token); myEmail = claims.email || myEmail;
    const m = await http("/rest/v1/auc_members?select=role&user_id=eq." + encodeURIComponent(claims.sub));
    role = m && m[0] ? m[0].role : null;
    if (!role || role === "sync") { $("na-email").textContent = myEmail; show("v-noaccess"); role = null; return; }
    $("who").textContent = myEmail + " - " + role;
    const canEdit = role === "admin" || role === "editor";
    $("b-add").hidden = !canEdit; $("syncBtn").hidden = !canEdit;
    $("b-team").hidden = role !== "admin"; $("b-audit").hidden = role !== "admin";
    buildControls(); show("v-app"); await loadItems(); loadSyncInfo();
  }
  async function signOut() { try { await http("/auth/v1/logout", { method: "POST" }); } catch (e) {} saveSess(null); location.reload(); }

  async function loadItems() {
    try { items = await http("/rest/v1/auc_items?select=*&order=id.desc&limit=2000"); } catch (e) { toast("Could not load: " + e.message); return; }
    const sel = $("acct"), keep = sel.value; sel.length = 1;
    [...new Set(items.map((i) => i.source_account).filter(Boolean))].sort().forEach((a) => sel.append(el("option", { value: a, text: a })));
    sel.value = keep; render();
  }
  async function loadSyncInfo() {
    try {
      const r = await http("/rest/v1/auc_sync_requests?select=*&order=id.desc&limit=1"), s = await http("/rest/v1/auc_sync_state?select=*&k=eq.last_sync_date");
      const last = s && s[0] ? s[0].v : null; const q = r && r[0];
      let t = last ? "Last sync: " + last : "No sync yet";
      if (q && (q.status === "pending" || q.status === "running")) t += " - update in progress";
      $("sync").textContent = t; return q;
    } catch (e) { return null; }
  }

  const SORTS = { win_date: "Date won", lot_title: "Item", all_in_cost: "Paid", amazon_retail_value: "Amazon price", pct: "% of retail", status: "Status" };
  function buildControls() {
    const c = $("chips"); c.textContent = "";
    [["stock", "In stock"], ["sold", "Sold"], ["used", "Used"], ["returned", "Returned"], ["all", "All"]].forEach(([k, l]) => {
      const b = el("button", { class: "chip", type: "button", text: l }); b.dataset.chip = k; b.setAttribute("aria-pressed", String(f.status === k)); c.append(b);
    });
    const s = $("sortSel"); s.textContent = ""; for (const k in SORTS) s.append(el("option", { value: k, text: SORTS[k] })); s.value = f.sort;
    $("dirBtn").textContent = f.dir < 0 ? "Desc" : "Asc";
  }
  const pct = (i) => (i.amazon_retail_value > 0 ? cost(i) / Number(i.amazon_retail_value) * 100 : null);
  function inFilter(i) {
    if (f.status === "stock" && !["pending", "reviewed", "listed"].includes(i.status)) return false;
    if (["sold", "used", "returned"].includes(f.status) && i.status !== f.status) return false;
    if (f.acct && i.source_account !== f.acct) return false;
    if (f.q && !((i.lot_title || "") + " " + (i.inv_no || "") + " " + (i.source_account || "") + " " + (i.notes || "")).toLowerCase().includes(f.q)) return false;
    return true;
  }
  function render() {
    const kept = items.filter((i) => i.status !== "returned");
    const stock = kept.filter((i) => ["pending", "reviewed", "listed"].includes(i.status)), sold = kept.filter((i) => i.status === "sold"), used = kept.filter((i) => i.status === "used");
    const sum = (a, fn) => a.reduce((t, i) => t + fn(i), 0);
    const rev = sum(sold, (i) => Number(i.sale_price) - Number(i.sale_fees || 0) - Number(i.sale_shipping || 0));
    const soldCost = sum(sold, cost), profit = rev - soldCost;
    const pers = sum(used.filter((i) => i.use_type === "personal"), cost), biz = sum(used.filter((i) => i.use_type === "business"), cost);
    const st = $("strip"); st.textContent = "";
    [["Kept items", String(kept.length), ""], ["In stock", String(stock.length) + " / " + money(sum(stock, cost)), ""], ["Sold", String(sold.length) + " / " + money(rev), ""],
     ["Profit on sold", money(profit), profit >= 0 ? "pos" : "neg"], ["Used - personal spending", money(pers), ""], ["Used - business expense", money(biz), ""]]
      .forEach(([l, v, c]) => st.append(el("div", { class: "stat" }, el("b", { class: c, text: v }), el("span", { text: l }))));
    const rows = items.filter(inFilter), d = f.dir;
    const key = (i) => f.sort === "pct" ? pct(i) : f.sort === "all_in_cost" ? cost(i) : i[f.sort];
    rows.sort((a, b) => { const x = key(a), y = key(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * d; });
    const list = $("list"); list.textContent = "";
    rows.forEach((i) => list.append(card(i)));
    if (!rows.length) list.append(el("p", { class: "sub", text: "Nothing here." }));
    $("foot").textContent = rows.length + " shown. Returned items are excluded from totals.";
  }
  function card(i) {
    const canEdit = role === "admin" || role === "editor";
    const img = safeUrl(i.image_url, IMG), amz = safeUrl(i.amazon_url, AMZ);
    const thumb = img ? el("img", { class: "thumb", src: img, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }) : el("div", { class: "thumb" });
    if (img) thumb.dataset.zoom = img;
    const p = pct(i);
    const nums = el("div", { class: "nums" }, el("span", {}, "Paid ", el("b", { text: money(cost(i)) + (i.cost_is_estimate && i.all_in_cost == null ? " est" : "") })),
      i.amazon_retail_value != null ? el("span", {}, "Amazon ", el("b", { text: money(Number(i.amazon_retail_value)) })) : null,
      p != null ? el("span", {}, el("b", { text: Math.round(p) + "%" }), " of retail") : null);
    if (i.status === "sold") { const net = Number(i.sale_price) - Number(i.sale_fees || 0) - Number(i.sale_shipping || 0) - cost(i); nums.append(el("span", {}, "Sold ", el("b", { text: money(Number(i.sale_price)) })), el("span", {}, "Profit ", el("b", { class: net >= 0 ? "pos" : "neg", text: money(net) }))); }
    if (i.status === "used") nums.append(el("span", {}, el("b", { text: i.use_type === "business" ? "Business expense" : "Personal spending" }), i.used_note ? " - " + i.used_note : ""));
    const acts = el("div", { class: "acts" });
    if (canEdit) {
      const add = (a, l) => { const b = el("button", { class: "btn sm", type: "button", text: l }); b.dataset.act = a; b.dataset.id = i.id; acts.append(b); };
      if (["pending", "reviewed", "listed"].includes(i.status)) { add("sell", "Sold"); add("use", "Used"); add("ret", "Returned"); }
      else add("restock", "Back to stock");
      add("edit", "Edit");
    }
    return el("div", { class: "card" }, thumb, el("div", {},
      el("h4", {}, i.lot_title, el("span", { class: "badge " + i.status, text: i.status })),
      el("div", { class: "meta", text: [i.inv_no ? "Inv " + i.inv_no : null, i.source_account, i.win_date ? "won " + i.win_date : null, i.condition].filter(Boolean).join(" - ") }),
      nums, amz ? el("div", { class: "meta" }, el("a", { href: amz, target: "_blank", rel: "noopener noreferrer", text: "Amazon link" })) : null, acts));
  }

  const find = (id) => items.find((x) => String(x.id) === String(id));
  function open(id) { const d = $(id); if (!d.open) d.showModal(); }
  function confirmBox(head, text, fn) { $("cHead").textContent = head; $("cText").textContent = text; confirmFn = fn; open("dConf"); }
  async function run(fn, okMsg) { try { await fn(); toast(okMsg); await loadItems(); } catch (e) { toast("Failed: " + e.message); } }

  async function onClick(ev) {
    const z = ev.target.closest("[data-zoom]"); if (z) { const zi = $("zoom"); zi.src = z.dataset.zoom; zi.classList.add("on"); return; }
    if ($("zoom").classList.contains("on")) { $("zoom").classList.remove("on"); return; }
    const ch = ev.target.closest("[data-chip]"); if (ch) { f.status = ch.dataset.chip; buildControls(); render(); return; }
    const cl = ev.target.closest("[data-close]"); if (cl) { $(cl.dataset.close).close(); return; }
    if (ev.target.id === "cOk") { $("dConf").close(); if (confirmFn) await confirmFn(); return; }
    const b = ev.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act; cur = b.dataset.id ? find(b.dataset.id) : cur;
    switch (a) {
      case "signout": return signOut();
      case "forgot": { const em = $("l-email").value.trim(); if (!em) { $("l-err").textContent = "Type your email above first."; return; }
        try { await http("/auth/v1/recover", { method: "POST", body: { email: em } }, false); } catch (e) {} $("l-err").textContent = "If that email has access, a reset link is on its way."; return; }
      case "dir": f.dir = -f.dir; buildControls(); render(); return;
      case "sell": $("sellTitle").textContent = cur.lot_title; $("sPrice").value = ""; $("sDate").value = today(); $("sFees").value = "0"; $("sShip").value = "0"; open("dSell"); return;
      case "doSell": { const p = num($("sPrice").value); if (p == null || p < 0) { toast("Enter the sale price"); return; }
        $("dSell").close(); return run(() => rpc("auc_sell", { p_id: cur.id, p_price: p, p_date: $("sDate").value || null, p_channel: $("sChan").value, p_fees: num($("sFees").value) || 0, p_ship: num($("sShip").value) || 0 }), "Marked sold"); }
      case "use": $("useTitle").textContent = cur.lot_title; $("uType").value = "personal"; $("uDate").value = today(); $("uNote").value = ""; open("dUse"); return;
      case "doUse": $("dUse").close(); return run(() => rpc("auc_use", { p_id: cur.id, p_type: $("uType").value, p_date: $("uDate").value || null, p_note: $("uNote").value.trim() || null }), "Marked used");
      case "ret": $("retTitle").textContent = cur.lot_title; $("rDate").value = today(); $("rRef").value = ""; open("dRet"); return;
      case "doRet": $("dRet").close(); return run(() => rpc("auc_return", { p_id: cur.id, p_date: $("rDate").value || null, p_refund: num($("rRef").value) }), "Marked returned");
      case "restock": return confirmBox("Back to stock?", "Clears the sale, use or return on this item.", () => run(() => rpc("auc_restock", { p_id: cur.id }), "Back in stock"));
      case "add": cur = null; fillEdit(null); open("dEdit"); return;
      case "edit": fillEdit(cur); open("dEdit"); return;
      case "doEdit": return saveEdit();
      case "delAsk": return confirmBox("Delete this item?", "This cannot be undone. A record stays in History.", async () => { $("dEdit").close(); await run(async () => { await http("/rest/v1/auc_items?id=eq." + cur.id, { method: "DELETE" }); }, "Deleted"); });
      case "csv": return exportCsv();
      case "sync": return doSync();
      case "team": return openTeam();
      case "addMember": return addMember();
      case "audit": return openAudit();
    }
  }
  function fillEdit(i) {
    $("eHead").textContent = i ? "Edit item" : "Add item"; $("eErr").textContent = ""; $("eDel").hidden = !(i && role === "admin");
    $("eTitle").value = i ? i.lot_title : ""; $("eHammer").value = i ? i.winning_bid : ""; $("eCost").value = i && i.all_in_cost != null && !i.cost_is_estimate ? i.all_in_cost : "";
    $("eAmz").value = i && i.amazon_url || ""; $("eRetail").value = i && i.amazon_retail_value != null ? i.amazon_retail_value : ""; $("eAcct").value = i && i.source_account || "";
    $("eCond").value = i && i.condition || ""; $("eInv").value = i && i.inv_no || ""; $("eInv").disabled = !!i; $("eImg").value = i && i.image_url || ""; $("eLoc").value = i && i.storage_location || ""; $("eNotes").value = i && i.notes || "";
  }
  async function saveEdit() {
    const er = $("eErr"); er.textContent = "";
    const t = $("eTitle").value.trim(), h = num($("eHammer").value), amz = $("eAmz").value.trim(), img = $("eImg").value.trim();
    if (!t) { er.textContent = "Title is required."; return; }
    if (h == null || h < 0) { er.textContent = "Price on Nellis is required."; return; }
    if (amz && !safeUrl(amz, AMZ)) { er.textContent = "Amazon link must be an https amazon.com link."; return; }
    if (img && !safeUrl(img, IMG)) { er.textContent = "Picture must come from Amazon or Nellis."; return; }
    const realCost = num($("eCost").value);
    const body = { lot_title: t, winning_bid: h, all_in_cost: realCost != null ? realCost : estCost(h), cost_is_estimate: realCost == null,
      amazon_url: amz || null, amazon_retail_value: num($("eRetail").value), source_account: $("eAcct").value.trim() || null, condition: $("eCond").value.trim() || null,
      image_url: img || null, storage_location: $("eLoc").value.trim() || null, notes: $("eNotes").value.trim() || null };
    try {
      if (cur) await http("/rest/v1/auc_items?id=eq." + cur.id, { method: "PATCH", body });
      else { body.inv_no = $("eInv").value.trim() || null; body.win_date = today(); await http("/rest/v1/auc_items", { method: "POST", body }); }
      $("dEdit").close(); toast("Saved"); await loadItems();
    } catch (e) { er.textContent = e.message; }
  }
  function exportCsv() {
    const cols = ["inv_no", "lot_title", "status", "source_account", "win_date", "winning_bid", "all_in_cost", "amazon_url", "amazon_retail_value", "sale_price", "sale_date", "sale_channel", "sale_fees", "sale_shipping", "use_type", "used_note", "returned_date", "notes"];
    const esc = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const rows = [cols.join(",")].concat(items.filter(inFilter).map((i) => cols.map((c) => esc(i[c])).join(",")));
    const a = el("a", { href: URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" })), download: "auction-inventory-" + today() + ".csv" });
    document.body.append(a); a.click(); a.remove();
  }
  async function doSync() {
    const b = $("syncBtn"); b.disabled = true;
    try {
      const q = await rpc("auc_request_sync"); $("sync").textContent = "Update requested. The Gmail reader picks it up within a few minutes.";
      for (let n = 0; n < 40; n++) {
        await new Promise((r) => setTimeout(r, 5000));
        const r = await http("/rest/v1/auc_sync_requests?select=*&id=eq." + q.id);
        if (r[0] && r[0].status === "done") { const x = r[0].result || {}; toast("Added " + (x.wins_added || 0) + " wins, " + ((x.returns_marked || 0) + (x.returns_added || 0)) + " returns"); await loadItems(); break; }
        if (r[0] && r[0].status === "failed") { toast("Update failed: " + (r[0].error || "unknown")); break; }
      }
    } catch (e) { toast(e.message); }
    b.disabled = false; loadSyncInfo();
  }
  async function openTeam() {
    try { members = await http("/rest/v1/auc_members?select=*&order=email"); } catch (e) { toast(e.message); return; }
    const l = $("teamList"); l.textContent = ""; $("tErr").textContent = "";
    members.forEach((m) => {
      const row = el("div", { class: "team-row" }, el("span", { class: "grow", text: m.email }));
      if (m.role === "sync") row.append(el("span", { class: "sub", text: "sync account" }));
      else {
        const s = el("select"); ["viewer", "editor", "admin"].forEach((r) => s.append(el("option", { value: r, text: r }))); s.value = m.role;
        s.addEventListener("change", () => setRole(m.email, s.value));
        const rm = el("button", { class: "btn sm danger", type: "button", text: "Remove" });
        rm.addEventListener("click", () => confirmBox("Remove " + m.email + "?", "They lose access immediately.", async () => { try { await rpc("auc_remove_member", { p_email: m.email }); toast("Removed"); openTeam(); } catch (e) { toast(e.message); } }));
        row.append(s, rm);
      }
      l.append(row);
    });
    open("dTeam");
  }
  async function setRole(email, r) { try { await rpc("auc_set_role", { p_email: email, p_role: r }); toast("Role updated"); } catch (e) { $("tErr").textContent = e.message; } }
  async function addMember() {
    const em = $("tEmail").value.trim(); if (!em) return;
    try { await rpc("auc_set_role", { p_email: em, p_role: $("tRole").value }); $("tEmail").value = ""; openTeam(); toast("Access given"); } catch (e) { $("tErr").textContent = e.message; }
  }
  async function openAudit() {
    try {
      const a = await http("/rest/v1/auc_audit?select=*&order=id.desc&limit=100"); const l = $("auditList"); l.textContent = "";
      a.forEach((r) => l.append(el("div", { text: new Date(r.at).toLocaleString() + " - " + (r.email || "system") + " - " + r.action + " - " + (r.changes && r.changes.title || r.changes && r.changes.inv_no || Object.keys(r.changes || {}).join(", ")) })));
      open("dAudit");
    } catch (e) { toast(e.message); }
  }
  start();
})();
