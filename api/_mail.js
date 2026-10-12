// Order email: tells the shop owner by email when a new order arrives. Sent with Resend (resend.com).
// The key, the address and the on/off switch are saved from Admin > Store settings, nothing is set in Vercel.
// Sending never throws and never takes longer than a few seconds, so an order is never held up or lost by it.
const { dbGet, siteBase } = require('./_lib');
const { getTracking } = require('./_track');

const DEFAULT_FROM = 'onboarding@resend.dev';   // works without your own domain, but only delivers to the Resend account's own email
const TIMEOUT_MS = 3000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');

const getNotify = async () => ({ enabled: false, to: '', from: '', apiKey: '', ...((await dbGet('notify', null)) || {}) });

async function sendMail({ apiKey, from, to, subject, html, text }) {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.message || 'HTTP ' + r.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'Resend did not answer in time' : e.message };
  }
}

// ---------- the email itself ----------
function orderEmail(order, { base, store }) {
  const abs = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : base + (u.startsWith('/') ? '' : '/') + u);
  const c = order.customer;
  const where = c.area === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka';
  const option = (i) => [i.size && 'Size ' + i.size, i.color].filter(Boolean).join(' · ');

  const rows = order.items.map((i) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eee;width:72px">${i.image ? `<img src="${esc(abs(i.image))}" alt="${esc(i.name)}" width="64" height="80" style="display:block;width:64px;height:80px;object-fit:cover;border-radius:4px;background:#f2f2f2">` : ''}</td>
      <td style="padding:12px 12px;border-bottom:1px solid #eee;font-size:14px;line-height:1.5"><b>${esc(i.name)}</b><br><span style="color:#666">${esc(option(i))}${option(i) ? ' · ' : ''}Qty ${i.qty} × ${money(i.price)}</span></td>
      <td style="padding:12px 0;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap"><b>${money(i.price * i.qty)}</b></td>
    </tr>`).join('');

  const line = (label, value, bold) => `<tr><td style="padding:4px 0;color:#666;font-size:14px">${label}</td><td style="padding:4px 0;text-align:right;font-size:${bold ? 18 : 14}px;${bold ? 'font-weight:700' : ''}">${value}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:20px 10px">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden">
      <tr><td style="background:#0a0a0a;color:#fff;padding:18px 22px;font-size:13px;letter-spacing:.08em">${esc(store).toUpperCase()}</td></tr>
      <tr><td style="padding:22px">
        <div style="font-size:12px;color:#666">NEW ORDER</div>
        <div style="font-size:24px;font-weight:700;margin:2px 0 4px">${esc(order.number)}</div>
        <div style="font-size:14px;color:#666;margin-bottom:18px">${money(order.total)} · Cash on delivery · ${where}</div>

        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
          ${line('Subtotal', money(order.subtotal))}${line('Delivery', order.shipping ? money(order.shipping) : 'Free')}${line('Total to collect', money(order.total), true)}
        </table>

        <div style="margin-top:22px;padding:14px 16px;background:#f7f7f5;border-radius:6px;font-size:14px;line-height:1.6">
          <b>${esc(c.name)}</b><br>
          <a href="tel:${esc(c.phone)}" style="color:#111">${esc(c.phone)}</a><br>
          ${esc(c.address)}
          ${c.note ? `<div style="margin-top:8px;color:#666">Note: ${esc(c.note)}</div>` : ''}
        </div>

        <div style="margin-top:22px"><a href="${esc(base)}/admin/" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px">Open in admin</a></div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `New order ${order.number} - ${money(order.total)} (cash on delivery, ${where})`, '',
    ...order.items.map((i) => `- ${i.name}${option(i) ? ' (' + option(i) + ')' : ''} x${i.qty} = ${money(i.price * i.qty)}`), '',
    `Subtotal ${money(order.subtotal)}, delivery ${order.shipping ? money(order.shipping) : 'free'}, total ${money(order.total)}`, '',
    `${c.name}`, `${c.phone}`, `${c.address}`, c.note ? `Note: ${c.note}` : '', '', `${base}/admin/`,
  ].filter((l, k, a) => l !== '' || a[k - 1] !== '').join('\n');

  return { subject: `New order ${order.number} · ${money(order.total)} · ${c.name}`, html, text };
}

// ---------- used by /api/orders: tell the owner about a new order ----------
async function notifyOrder(req, order, storeName) {
  try {
    const n = await getNotify();
    if (!n.enabled || !n.to || !n.apiKey) return { ok: false, skipped: true };
    const trk = await getTracking();
    const mail = orderEmail(order, { base: siteBase(req, trk.siteUrl), store: storeName || 'Janissary Wear' });
    const r = await sendMail({ apiKey: n.apiKey, from: `${storeName || 'Janissary Wear'} <${n.from || DEFAULT_FROM}>`, to: n.to, ...mail });
    if (!r.ok) console.error('Order email failed:', r.error);
    return r;
  } catch (e) {
    console.error('Order email failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { DEFAULT_FROM, getNotify, sendMail, orderEmail, notifyOrder };
