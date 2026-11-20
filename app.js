"use strict";
(function () {
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const SKEY = "auc_session";
  let sess = null, role = null, myEmail = "", items = [], members = [];
  const f = { status: "stock", q: "", acct: "" };
  let cur = null, confirmFn = null;

  // ---------- helpers ----------
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

  // ---------- http ----------
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

  // ---------- auth flow ----------
  async function start() {
    document.addEventListener("click", onClick);
    $("f-login").addEventListener("submit", doLogin);
    $("f-setpw").addEventListener("submit", doSetPw);
    $("f-mfa").addEventListener("submit", doMfa);
    $("q").addEventListener("input", (e) => { f.q = e.target.value.toLowerCase(); render(); });
    $("acct").addEventListener("change", (e) => { f.acct = e.target.value; render(); });
    const zoom = $("zoom");
    document.addEventListener("mouseover", (e) => { const z = e.target.closest && e.target.closest("[data-zoom]"); if (!z) return; zoom.src = z.dataset.zoom; const r = z.getBoundingClientRect(); zoom.style.left = Math.min(r.right + 10, innerWidth - 256) + "px"; zoom.style.top = Math.max(8, Math.min(r.top - 80, innerHeight - 256)) + "px"; zoom.style.display = "block"; });
    document.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest("[data-zoom]")) zoom.style.display = "none"; });
    document.addEventListener("error", (e) => { const t = e.target; if (t && t.tagName === "IMG" && t.classList.contains("thumb")) { const sp = document.createElement("span"); sp.className = "thumb none"; t.replaceWith(sp); } }, true);
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

  // ---------- data ----------
  async function loadItems() {
    try { items = await http("/rest/v1/auc_items?select=*&order=id.desc&limit=2000"); } catch (e) { toast("Could not load: " + e.message); return; }
    const sel = $("acct"), keep = sel.value; sel.length = 1;
    [...new Set(items.map((i) => i.source_account).filter(Boolean))].sort().forEach((a) => sel.append(el("option", { value: a, text: a })));
    sel.value = keep; render();
  }
  async function loadSyncInfo() {
    try {
      const r = await http("/rest/v1/auc_sync_requests?select=*&order=id.desc&limit=1"), st = await http("/rest/v1/auc_sync_state?select=*&k=eq.last_sync_date");
      const last = st && st[0] ? st[0].v : null; const q = r && r[0];
      let cls = "", t = last ? "Last Gmail sync: " + last + "." : "Gmail sync has not run yet.";
      if (q && (q.status === "pending" || q.status === "running")) { cls = "run"; t += " Update in progress."; }
      else if (q && q.status === "failed") { cls = "bad"; t += " Last update request failed: " + (q.error || "unknown") + "."; }
      else if (q && q.status === "done") { cls = "ok"; const x = q.result || {}; t += " Last update: " + (x.wins_added || 0) + " new wins, " + ((x.returns_marked || 0) + (x.returns_added || 0)) + " returns, " + ((x.wins_duplicate || 0) + (x.returns_duplicate || 0)) + " already known."; if ((x.needs_review || []).length) t += " Needs review: " + x.needs_review.join("; "); }
      $("sync").innerHTML = '<span class="dot ' + cls + '"></span><span>' + esc(t) + "</span>"; return q;
    } catch (e) { return null; }
  }

  // ---------- render (ledger table) ----------
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const m2 = (n) => (n == null || n === "") ? "" : money(Number(n));
  const inStock = (i) => ["pending", "reviewed", "listed"].includes(i.status);
  const pct = (i) => (i.amazon_retail_value > 0 ? cost(i) / Number(i.amazon_retail_value) * 100 : null);
  const profitOf = (i) => i.status === "sold" && i.sale_price != null ? Number(i.sale_price) - Number(i.sale_fees || 0) - Number(i.sale_shipping || 0) - cost(i) : null;
  const titleOf = (i) => i.lot_title || "(untitled)";
  const STORDER = { pending: 1, reviewed: 1, listed: 1, used: 2, sold: 3, returned: 4 };
  const VKEY = "auc_view";
  let view = Object.assign({ sort: "won", dir: "desc" }, (() => { try { return JSON.parse(localStorage.getItem(VKEY) || "{}"); } catch (e) { return {}; } })());
  const COLS = [
    { k: "item", label: "Item", cls: "item", get: (i) => titleOf(i).toLowerCase(), type: "s" },
    { k: "acct", label: "Account", get: (i) => (i.source_account || "").toLowerCase(), type: "s" },
    { k: "won", label: "Won", get: (i) => i.win_date || "", type: "s" },
    { k: "paid", label: "Paid (all-in)", cls: "r", get: cost, type: "n" },
    { k: "link", label: "Amazon link", get: (i) => i.amazon_url ? 1 : null, type: "n" },
    { k: "price", label: "Amazon price", cls: "r", get: (i) => i.amazon_retail_value == null ? null : Number(i.amazon_retail_value), type: "n" },
    { k: "pct", label: "% of retail", cls: "r", get: pct, type: "n" },
    { k: "status", label: "Status", get: (i) => STORDER[i.status] == null ? 9 : STORDER[i.status], type: "n" },
    { k: "result", label: "Result", get: profitOf, type: "n" }
  ];
  const ARROW = '<svg class="arr" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5v-7M2 4.5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TABS = [["stock", "In stock"], ["sold", "Sold"], ["used", "Used"], ["returned", "Returned"], ["all", "All"]];
  const inTab = (i) => f.status === "all" ? true : f.status === "stock" ? inStock(i) : i.status === f.status;
  function cmp(a, b) {
    const col = COLS.find((c) => c.k === view.sort) || COLS[2], va = col.get(a), vb = col.get(b);
    const ea = va == null || va === "", eb = vb == null || vb === "";
    if (ea && eb) return 0; if (ea) return 1; if (eb) return -1;
    const r = col.type === "n" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
    return view.dir === "asc" ? r : -r;
  }
  function setSort(k) {
    if (view.sort === k) view.dir = view.dir === "asc" ? "desc" : "asc";
    else { view.sort = k; view.dir = ["won", "paid", "price", "pct", "result"].includes(k) ? "desc" : "asc"; }
    localStorage.setItem(VKEY, JSON.stringify(view)); render();
  }
  function renderHead() {
    $("head").innerHTML = COLS.map((c) => '<th class="' + (c.cls || "") + '" scope="col" aria-sort="' + (view.sort === c.k ? (view.dir === "asc" ? "ascending" : "descending") : "none") + '"><button type="button" data-sort="' + c.k + '" title="Sort by ' + esc(c.label) + '">' + esc(c.label) + ARROW + "</button></th>").join("") + '<th class="plain" scope="col">Actions</th>';
  }
  function renderChips() {
    $("chips").innerHTML = TABS.map(([k, n]) => '<button class="chip" type="button" data-chip="' + k + '" aria-pressed="' + (f.status === k) + '">' + n + "<i>" + items.filter((x) => k === "all" ? true : k === "stock" ? inStock(x) : x.status === k).length + "</i></button>").join("");
  }
  function buildControls() { renderHead(); renderChips(); }
  function renderStrip() {
    const kept = items.filter((i) => i.status !== "returned"), stock = items.filter(inStock), sold = items.filter((i) => i.status === "sold");
    const sum = (a) => a.reduce((t, i) => t + cost(i), 0);
    const spent = sum(kept), stockCost = sum(stock), retail = stock.reduce((t, i) => t + Number(i.amazon_retail_value || 0), 0);
    const profit = sold.reduce((t, i) => t + (profitOf(i) || 0), 0);
    const used = (k) => items.filter((i) => i.status === "used" && (k === "personal" ? i.use_type !== "business" : i.use_type === "business"));
    const priced = stock.filter((i) => i.amazon_retail_value > 0);
    const wpct = priced.length ? sum(priced) / priced.reduce((t, i) => t + Number(i.amazon_retail_value), 0) * 100 : null;
    const st = (l, v, s, c) => '<div class="stat"><span>' + l + '</span><b class="' + (c || "") + '">' + v + "</b><small>" + (s || "&nbsp;") + "</small></div>";
    $("strip").innerHTML =
      st("Total spent", esc(money(spent)), kept.length + " items kept") +
      st("In stock", esc(money(stockCost)), stock.length + " items") +
      st("Amazon value in stock", esc(money(retail)), priced.length === stock.length ? "all priced" : priced.length + " of " + stock.length + " priced") +
      st("Paid vs retail", wpct === null ? "-" : wpct.toFixed(0) + "%", "priced items only") +
      st("Sold profit", esc(money(profit)), sold.length + " sold", profit >= 0 ? "pos" : "neg") +
      st("Personal spending", esc(money(sum(used("personal")))), used("personal").length + " used") +
      st("Business expense", esc(money(sum(used("business")))), used("business").length + " used");
  }
  function render() {
    renderHead(); renderStrip(); renderChips();
    const q = f.q, list = items.filter(inTab).filter((i) => !f.acct || i.source_account === f.acct)
      .filter((i) => !q || [i.lot_title, i.inv_no, i.source_account, i.notes].join(" ").toLowerCase().includes(q)).sort(cmp);
    $("rows").innerHTML = list.map(rowHtml).join("") ||
      '<tr><td colspan="10" class="empty"><b>' + (q || f.acct ? "No items match" : "Nothing here yet") + "</b>" + (q || f.acct ? "Clear the search or account filter." : f.status === "stock" ? "Items you win appear here after Update now." : "Items move here when you mark them.") + "</td></tr>";
    const paid = list.reduce((t, i) => t + cost(i), 0), pr = list.filter((i) => i.amazon_retail_value > 0);
    const rt = pr.reduce((t, i) => t + Number(i.amazon_retail_value), 0), pd = pr.reduce((t, i) => t + cost(i), 0);
    $("foot").innerHTML = '<span class="foot-sum">' + list.length + " items &middot; paid " + esc(money(paid)) + (pr.length ? " &middot; Amazon price " + esc(money(rt)) + " on " + pr.length + " priced &middot; " + (pd / rt * 100).toFixed(1) + "% of retail" : "") + "</span>";
  }
  function rowHtml(i) {
    const canEdit = role === "admin" || role === "editor";
    const img = safeUrl(i.image_url, IMG), amz = safeUrl(i.amazon_url, AMZ), t = titleOf(i), p = pct(i), pf = profitOf(i);
    const thumb = img ? '<img class="thumb" src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-zoom="' + esc(img) + '">' : '<span class="thumb none" aria-hidden="true"></span>';
    let result = "";
    if (i.status === "sold") result = esc(money(Number(i.sale_price))) + ' <span class="mut">' + esc(i.sale_date || "") + " " + esc(i.sale_channel || "") + '</span><br><span class="' + (pf >= 0 ? "pos" : "neg") + '">profit ' + esc(money(pf)) + "</span>";
    else if (i.status === "used") result = (i.use_type === "business" ? "Business expense" : "Personal spending") + '<br><span class="mut">' + esc(i.used_note || "") + "</span>";
    else if (i.status === "returned") result = "Returned " + esc(i.returned_date || "") + (i.refund_amount != null ? '<br><span class="mut">refund ' + esc(money(Number(i.refund_amount))) + "</span>" : "");
    const b = (a, l) => '<button class="btn sm" type="button" data-act="' + a + '" data-id="' + i.id + '">' + l + "</button>";
    let acts = "";
    if (canEdit) acts = (inStock(i) ? b("sell", "Sold") + b("use", "Used") + b("ret", "Return") : b("restock", "Undo")) + b("edit", "Edit");
    return '<tr><td class="item"><div class="it">' + thumb + '<div><div class="t1" title="' + esc(t) + '">' + esc(t) + '</div><div class="t2">' + esc(i.inv_no || "") + " &middot; " + esc(i.condition || "") + " " + esc((i.yard || "").split(" - ")[0]) + "</div></div></div></td>" +
      '<td class="mut">' + esc(i.source_account || "") + '</td><td class="num">' + esc(i.win_date || "") + "</td>" +
      '<td class="num">' + esc(money(cost(i))) + (i.cost_is_estimate && i.all_in_cost == null ? '<span class="est">est</span>' : "") + '<div class="mut">price ' + esc(m2(i.winning_bid)) + "</div></td>" +
      "<td>" + (amz ? '<a href="' + esc(amz) + '" target="_blank" rel="noopener noreferrer">Amazon</a>' : '<span class="mut">none</span>') + "</td>" +
      '<td class="num">' + esc(m2(i.amazon_retail_value)) + '</td><td class="num">' + (p === null ? "" : p.toFixed(1) + "%") + "</td>" +
      '<td><span class="pill st-' + esc(i.status) + '">' + esc(i.status === "pending" ? "in stock" : i.status) + "</span></td>" +
      "<td>" + result + '</td><td><div class="acts">' + acts + "</div></td></tr>";
  }

  // ---------- actions ----------
  const find = (id) => items.find((x) => String(x.id) === String(id));
  function open(id) { const d = $(id); if (!d.open) d.showModal(); }
  function confirmBox(head, text, fn) { $("cHead").textContent = head; $("cText").textContent = text; confirmFn = fn; open("dConf"); }
  async function run(fn, okMsg) { try { await fn(); toast(okMsg); await loadItems(); } catch (e) { toast("Failed: " + e.message); } }

  async function onClick(ev) {
    const so = ev.target.closest("[data-sort]"); if (so) { setSort(so.dataset.sort); return; }
    const ch = ev.target.closest("[data-chip]"); if (ch) { f.status = ch.dataset.chip; buildControls(); render(); return; }
    const cl = ev.target.closest("[data-close]"); if (cl) { $(cl.dataset.close).close(); return; }
    if (ev.target.id === "cOk") { $("dConf").close(); if (confirmFn) await confirmFn(); return; }
    const b = ev.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act; cur = b.dataset.id ? find(b.dataset.id) : cur;
    switch (a) {
      case "signout": return signOut();
      case "forgot": { const em = $("l-email").value.trim(); if (!em) { $("l-err").textContent = "Type your email above first."; return; }
        try { await http("/auth/v1/recover", { method: "POST", body: { email: em } }, false); } catch (e) {} $("l-err").textContent = "If that email has access, a reset link is on its way."; return; }
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
    const rows = [cols.join(",")].concat(items.filter((i) => inTab(i) && (!f.acct || i.source_account === f.acct)).map((i) => cols.map((c) => esc(i[c])).join(",")));
    const a = el("a", { href: URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" })), download: "auction-inventory-" + today() + ".csv" });
    document.body.append(a); a.click(); a.remove();
  }
  async function doSync() {
    const b = $("syncBtn"); b.disabled = true;
    try {
      const q = await rpc("auc_request_sync"); $("sync").innerHTML = '<span class="dot run"></span><span>Update requested. The Gmail reader picks it up within a few minutes.</span>';
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
