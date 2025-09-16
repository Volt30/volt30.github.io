/**
 * Simple Order Website (Express + Nodemailer)
 * --------------------------------------------------
 * What this does
 * - Serves a one-page shop with a small cart
 * - Sends the order details to your email (default: jiajiou@jiajiou.com)
 * - Validates totals on the server using the catalog to prevent tampering
 *
 * How to run (local)
 * 1) Save this as server.js
 * 2) npm init -y
 * 3) npm i express nodemailer
 * 4) Set env vars (see below) OR edit the transporter config
 * 5) node server.js   (then open http://localhost:3000)
 *
 * SMTP ENV (recommended)
 * - SMTP_HOST=...
 * - SMTP_PORT=465 (or 587)
 * - SMTP_USER=...
 * - SMTP_PASS=...
 * - ORDER_TO=jiajiou@jiajiou.com (default)
 * - ORDER_FROM="Goblin Village <no-reply@yourdomain.com>"
 *
 * For Gmail: enable 2FA, create an App Password, then use
 *   SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=your@gmail.com, SMTP_PASS=app_password
 */

const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Catalog (edit these as you like) ------------------------------------
// price in TWD
const CATALOG = [
  { id: "A01", name: "村長脫衣娃娃大禮包", price: 1890 },
  { id: "B01", name: "盲抽隨機胸章 (1枚)", price: 120 },
  { id: "C01", name: "村莊英雄特典卡 (1張)", price: 80 },
  { id: "D01", name: "村長拐杖 配件", price: 150 },
];

// Optional shipping & payment presets
const SHIPPING = [
  { id: "S-711", name: "7-11 店到店", price: 60 },
  { id: "S-HOME", name: "宅配 (本島)", price: 130 },
  { id: "S-INTL", name: "國際寄送 (估價後補)", price: 0 },
];

const PAYMENTS = [
  { id: "P-CARD", name: "信用卡" },
  { id: "P-COD", name: "貨到付款 (僅台灣)" },
  { id: "P-INTL", name: "國際匯款 / PayPal" },
];

// ---- Utilities ------------------------------------------------------------
const byId = (arr, id) => arr.find((x) => x.id === id);

function formatCurrency(n) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD" }).format(n);
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Email Transporter ----------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_PORT || 465) === "465", // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER || "YOUR_SMTP_USER",
    pass: process.env.SMTP_PASS || "YOUR_SMTP_PASSWORD",
  },
});

const ORDER_TO = process.env.ORDER_TO || "jiajiou@jiajiou.com";
const ORDER_FROM = process.env.ORDER_FROM || "Goblin Village <no-reply@example.com>";

// ---- Routes ---------------------------------------------------------------
app.get("/catalog", (req, res) => {
  res.json({ catalog: CATALOG, shipping: SHIPPING, payments: PAYMENTS });
});

app.get("/", (req, res) => {
  res.type("html").send(getPageHtml());
});

app.post("/order", async (req, res) => {
  try {
    const {
      items = [], // [{id, qty}]
      shippingId,
      paymentId,
      buyer = {}, // {name, email, phone, address, note}
    } = req.body || {};

    // Basic validation
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "購物車是空的" });
    }

    // Build server-side order lines from catalog (prevents price tampering)
    const orderLines = [];
    let itemsTotal = 0;
    for (const it of items) {
      const prod = byId(CATALOG, it.id);
      const qty = Math.max(1, Math.min(999, Number(it.qty || 1)));
      if (!prod) continue;
      const lineTotal = prod.price * qty;
      orderLines.push({ id: prod.id, name: prod.name, price: prod.price, qty, lineTotal });
      itemsTotal += lineTotal;
    }

    if (orderLines.length === 0) {
      return res.status(400).json({ ok: false, message: "所有品項無效，請重新選擇" });
    }

    const ship = shippingId ? byId(SHIPPING, shippingId) : null;
    const pay = paymentId ? byId(PAYMENTS, paymentId) : null;
    const shippingFee = ship ? ship.price : 0;
    const grandTotal = itemsTotal + shippingFee;

    const orderId = "GV" + Date.now();

    // Compose email
    const subject = `新訂單 ${orderId} / 合計 ${formatCurrency(grandTotal)}`;

    const linesHtml = orderLines
      .map(
        (l) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(l.id)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(l.name)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;" align="right">${formatCurrency(l.price)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;" align="right">${l.qty}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;" align="right">${formatCurrency(l.lineTotal)}</td>
        </tr>`
      )
      .join("");

    const html = `
      <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto">
        <h2>新訂單：${escapeHtml(orderId)}</h2>
        <p><b>建立時間：</b>${new Date().toLocaleString("zh-TW")}</p>
        <h3>購買品項</h3>
        <table style="border-collapse:collapse;width:100%;max-width:720px">
          <thead>
            <tr>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #333;">編號</th>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #333;">品名</th>
              <th align="right" style="padding:6px 8px;border-bottom:2px solid #333;">單價</th>
              <th align="right" style="padding:6px 8px;border-bottom:2px solid #333;">數量</th>
              <th align="right" style="padding:6px 8px;border-bottom:2px solid #333;">小計</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="4" align="right" style="padding:8px;">商品合計</td>
              <td align="right" style="padding:8px;">${formatCurrency(itemsTotal)}</td>
            </tr>
            <tr>
              <td colspan="4" align="right" style="padding:8px;">運費${ship ? `（${escapeHtml(ship.name)}）` : ""}</td>
              <td align="right" style="padding:8px;">${formatCurrency(shippingFee)}</td>
            </tr>
            <tr>
              <td colspan="4" align="right" style="padding:12px 8px;font-weight:bold;border-top:2px solid #333;">應付總額</td>
              <td align="right" style="padding:12px 8px;font-weight:bold;border-top:2px solid #333;">${formatCurrency(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
        <h3 style="margin-top:24px;">買家資訊</h3>
        <ul>
          <li><b>姓名：</b>${escapeHtml(buyer.name)}</li>
          <li><b>Email：</b>${escapeHtml(buyer.email)}</li>
          <li><b>電話：</b>${escapeHtml(buyer.phone)}</li>
          <li><b>地址/門市：</b>${escapeHtml(buyer.address)}</li>
          <li><b>付款方式：</b>${pay ? escapeHtml(pay.name) : "未選擇"}</li>
          <li><b>備註：</b>${escapeHtml(buyer.note)}</li>
        </ul>
      </div>
    `;

    const text = [
      `新訂單 ${orderId}`,
      `建立時間: ${new Date().toLocaleString("zh-TW")}`,
      "",
      "【購買品項】",
      ...orderLines.map(
        (l) => `- ${l.id} ${l.name} x${l.qty}  單價${l.price}  小計${l.lineTotal}`
      ),
      `商品合計: ${itemsTotal}`,
      `運費: ${shippingFee}${ship ? ` (${ship.name})` : ""}`,
      `應付總額: ${grandTotal}`,
      "",
      "【買家資訊】",
      `姓名: ${buyer.name || ""}`,
      `Email: ${buyer.email || ""}`,
      `電話: ${buyer.phone || ""}`,
      `地址/門市: ${buyer.address || ""}`,
      `付款方式: ${pay ? pay.name : "未選擇"}`,
      `備註: ${buyer.note || ""}`,
    ].join("\n");

    // Send email
    await transporter.sendMail({
      from: ORDER_FROM,
      to: ORDER_TO,
      subject,
      text,
      html,
    });

    res.json({ ok: true, orderId, grandTotal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "寄送失敗，請稍後再試" });
  }
});

// ---- Server start ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Order website running: http://localhost:${PORT}`);
});

// ---- Page (client) --------------------------------------------------------
function getPageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>哥布林村莊｜訂購</title>
  <style>
    :root{ --bg:#0b0f14; --card:#121a22; --muted:#6b7785; --text:#e6edf3; --acc:#4aa3ff; }
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(180deg,#0b0f14,#0e141b 40%,#101720);color:var(--text);font:16px/1.6 system-ui, -apple-system, Segoe UI, Roboto}
    .wrap{max-width:1100px;margin:40px auto;padding:0 16px}
    h1{font-size:28px;margin:0 0 16px}
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
    .card{background:var(--card);border:1px solid #1d2631;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
    .pad{padding:16px}
    .muted{color:var(--muted)}
    .btn{cursor:pointer;border:0;border-radius:12px;padding:10px 14px;background:var(--acc);color:#071522;font-weight:700}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    .btn-ghost{background:transparent;border:1px solid #223040;color:var(--text)}
    .row{display:flex;gap:8px;align-items:center}
    .row > * {flex:1}
    input,select,textarea{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #223040;background:#0d141c;color:var(--text)}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px 10px;border-bottom:1px solid #1d2631}
    th{color:#9fb3c8;text-align:left}
    tfoot td{font-weight:700}
    .right{text-align:right}
    .tag{font-size:12px;padding:3px 8px;background:#0b1622;border:1px solid #223040;border-radius:999px;color:#8eb8ff}
    .qty{display:inline-flex;border:1px solid #223040;border-radius:10px;overflow:hidden}
    .qty button{all:unset;cursor:pointer;padding:6px 10px;background:#0b1622}
    .qty input{width:40px;text-align:center;border:0;background:#0d141c}
    .ok{color:#6bff9b}
    .warn{color:#ffd06b}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>哥布林村莊｜訂購 <span class="tag" id="orderId"></span></h1>
    <div class="grid">
      <section class="card pad" style="grid-column: span 7;">
        <h2>商品</h2>
        <div id="catalog"></div>
      </section>
      <aside class="card pad" style="grid-column: span 5;">
        <h2>購物車</h2>
        <div id="cartEmpty" class="muted">尚未選擇商品</div>
        <table id="cartTable" style="display:none">
          <thead><tr><th>品名</th><th class="right">單價</th><th class="right">數量</th><th class="right">小計</th><th></th></tr></thead>
          <tbody id="cartBody"></tbody>
          <tfoot>
            <tr><td colspan="3" class="right">商品合計</td><td class="right" id="itemsTotal">$0</td><td></td></tr>
            <tr><td colspan="3" class="right">運費</td><td class="right" id="shipFee">$0</td><td></td></tr>
            <tr><td colspan="3" class="right">應付總額</td><td class="right" id="grand">$0</td><td></td></tr>
          </tfoot>
        </table>
        <div style="height:12px"></div>
        <div class="row">
          <select id="shipping"></select>
          <select id="payment"></select>
        </div>
        <div style="height:12px"></div>
        <div class="row"><input id="name" placeholder="姓名" /><input id="email" placeholder="Email" /></div>
        <div style="height:8px"></div>
        <div class="row"><input id="phone" placeholder="電話" /><input id="address" placeholder="地址 / 門市" /></div>
        <div style="height:8px"></div>
        <textarea id="note" rows="3" placeholder="備註（例如：收件時段、發票抬頭...）"></textarea>
        <div style="height:12px"></div>
        <button class="btn" id="checkout">送出訂單</button>
        <div id="status" class="muted" style="margin-top:8px"></div>
      </aside>
    </div>
  </div>

  <script>
    const fmt = new Intl.NumberFormat('zh-TW', { style:'currency', currency:'TWD' });
    const state = { catalog:[], shipping:[], payments:[], cart:[], shippingId:null, paymentId:null };

    async function boot(){
      const res = await fetch('/catalog');
      const data = await res.json();
      state.catalog = data.catalog; state.shipping = data.shipping; state.payments = data.payments;
      state.shippingId = state.shipping[0]?.id || null; state.paymentId = state.payments[0]?.id || null;
      renderCatalog(); renderSelectors(); renderCart();
      document.getElementById('checkout').addEventListener('click', checkout);
    }

    function renderCatalog(){
      const root = document.getElementById('catalog');
      root.innerHTML = '';
      state.catalog.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card pad';
        card.style.marginBottom = '10px';
        card.innerHTML = `
          <div class="row" style="align-items:flex-start;gap:12px">
            <div style="flex:1">
              <div style="font-weight:700;font-size:18px">${p.name}</div>
              <div class="muted">#${p.id}</div>
            </div>
            <div class="right" style="min-width:160px">
              <div style="font-weight:700">${fmt.format(p.price)}</div>
              <div style="height:6px"></div>
              <div class="qty">
                <button onclick="changeQty('${p.id}', -1)">-</button>
                <input id="qty-${p.id}" type="number" min="1" max="999" value="1" />
                <button onclick="changeQty('${p.id}', 1)">+</button>
              </div>
              <div style="height:6px"></div>
              <button class="btn" onclick="addToCart('${p.id}')">加入購物車</button>
            </div>
          </div>`;
        root.appendChild(card);
      });
    }

    function changeQty(id, d){
      const el = document.getElementById('qty-'+id);
      let v = parseInt(el.value||'1',10)+d; v = Math.min(999, Math.max(1, v)); el.value = v;
    }

    function addToCart(id){
      const qty = parseInt(document.getElementById('qty-'+id).value||'1',10);
      const exist = state.cart.find(x => x.id === id);
      if(exist) exist.qty = Math.min(999, exist.qty + qty); else state.cart.push({ id, qty });
      renderCart();
    }

    function removeFromCart(id){ state.cart = state.cart.filter(x => x.id !== id); renderCart(); }

    function renderSelectors(){
      const ship = document.getElementById('shipping');
      const pay = document.getElementById('payment');
      ship.innerHTML = state.shipping.map(s => `<option value="${s.id}">${s.name} ${s.price? '('+fmt.format(s.price)+')':''}</option>`).join('');
      pay.innerHTML = state.payments.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      ship.value = state.shippingId; pay.value = state.paymentId;
      ship.onchange = (e)=>{ state.shippingId = e.target.value; renderCart(); };
      pay.onchange = (e)=>{ state.paymentId = e.target.value; };
    }

    function renderCart(){
      const empty = document.getElementById('cartEmpty');
      const table = document.getElementById('cartTable');
      const body = document.getElementById('cartBody');
      body.innerHTML = '';
      if(state.cart.length === 0){ empty.style.display='block'; table.style.display='none'; updateTotals(0); return; }
      empty.style.display='none'; table.style.display='table';

      let itemsTotal = 0;
      for(const line of state.cart){
        const p = state.catalog.find(x=>x.id===line.id); if(!p) continue;
        const sub = p.price * line.qty; itemsTotal += sub;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${p.name}</td>
          <td class="right">${fmt.format(p.price)}</td>
          <td class="right">
            <div class="qty" style="float:right">
              <button onclick="updateLineQty('${line.id}', -1)">-</button>
              <input value="${line.qty}" style="width:44px;text-align:center"/>
              <button onclick="updateLineQty('${line.id}', 1)">+</button>
            </div>
          </td>
          <td class="right">${fmt.format(sub)}</td>
          <td class="right"><button class="btn-ghost" onclick="removeFromCart('${line.id}')">刪除</button></td>`;
        body.appendChild(tr);
      }

      updateTotals(itemsTotal);
    }

    function updateLineQty(id, d){
      const line = state.cart.find(x=>x.id===id); if(!line) return;
      line.qty = Math.min(999, Math.max(1, (line.qty||1)+d));
      renderCart();
    }

    function updateTotals(itemsTotal){
      const ship = state.shipping.find(s=>s.id===state.shippingId);
      const shipFee = ship ? (ship.price||0) : 0;
      document.getElementById('itemsTotal').textContent = fmt.format(itemsTotal);
      document.getElementById('shipFee').textContent = fmt.format(shipFee);
      document.getElementById('grand').textContent = fmt.format(itemsTotal + shipFee);
    }

    async function checkout(){
      const status = document.getElementById('status');
      status.textContent = '';
      if(state.cart.length===0){ status.textContent = '⛔ 請先加入商品'; return; }
      const buyer = {
        name: document.getElementById('name').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        address: document.getElementById('address').value.trim(),
        note: document.getElementById('note').value.trim(),
      };
      if(!buyer.name || !buyer.email){ status.textContent = '⛔ 請填寫姓名與 Email'; return; }

      const payload = {
        items: state.cart.map(x=>({ id:x.id, qty:x.qty })),
        shippingId: state.shippingId,
        paymentId: state.paymentId,
        buyer,
      };

      const btn = document.getElementById('checkout');
      btn.disabled = true; status.textContent = '⌛ 正在送出訂單...';
      try{
        const resp = await fetch('/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await resp.json();
        if(data.ok){
          document.getElementById('orderId').textContent = data.orderId;
          status.innerHTML = '<span class="ok">✔ 訂單已送出，我們已寄出通知到店家。</span>';
          state.cart = []; renderCart();
        } else {
          status.innerHTML = '<span class="warn">⚠ '+(data.message||'送出失敗')+'</span>';
        }
      }catch(e){
        status.innerHTML = '<span class="warn">⚠ 網路或伺服器錯誤</span>';
      } finally {
        btn.disabled = false;
      }
    }

    boot();
  </script>
</body>
</html>`;
}
