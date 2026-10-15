// Where orders are kept. Every order is saved on its own (order:<id>), so placing an order never rewrites the other orders,
// and a few small lists make look-ups quick: newest first, by phone number, by order number.
const { redis, pipe, dbGet, dbSet } = require('./_lib');

// the last 10 digits of a Bangladesh mobile number, so 01712.., +88 01712.. and 8801712.. all match
const phoneKey = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const numberKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^JW/, '');

const LIST = 'orders:list';
const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

// the commands that file one order into the lists
const filing = (o) => {
  const cmds = [['SET', 'order:' + o.id, JSON.stringify(o)], ['SET', 'ordnum:' + numberKey(o.number), o.id]];
  const pk = phoneKey(o.customer && o.customer.phone);
  return { cmds, phoneList: pk ? 'ophone:' + pk : '' };
};

async function saveOrder(o) {
  const { cmds, phoneList } = filing(o);
  cmds.push(['LPUSH', LIST, o.id]);
  if (phoneList) cmds.push(['LPUSH', phoneList, o.id]);
  await pipe(cmds);
}

const updateOrder = (o) => redis(['SET', 'order:' + o.id, JSON.stringify(o)]);

async function removeOrder(o) {
  const cmds = [['DEL', 'order:' + o.id], ['DEL', 'ordnum:' + numberKey(o.number)], ['LREM', LIST, 0, o.id]];
  const pk = phoneKey(o.customer && o.customer.phone);
  if (pk) cmds.push(['LREM', 'ophone:' + pk, 0, o.id]);
  await pipe(cmds);
}

async function getOrders(ids) {
  if (!ids.length) return [];
  const raws = await redis(['MGET', ...ids.map((id) => 'order:' + id)]);
  return raws.map(parse).filter(Boolean);
}
const getOrder = async (id) => (await getOrders([id]))[0] || null;

// newest first; limit 0 = all of them
async function listOrders(limit = 1000) {
  return getOrders(await redis(['LRANGE', LIST, 0, limit > 0 ? limit - 1 : -1]));
}
async function ordersByPhone(pk, max = 30) {
  return getOrders(await redis(['LRANGE', 'ophone:' + pk, 0, max - 1]));
}
async function orderByNumber(nk) {
  const id = await redis(['GET', 'ordnum:' + nk]);
  return id ? getOrder(id) : null;
}

// numbers that never repeat: JW-1001, JW-1002 ...
async function nextNumber() { return 'JW-' + (1000 + (await redis(['INCR', 'order:seq']))); }

// Orders saved by the older version of the site (one long list under "orders") move to the new places, once.
let done = false;
async function ensureMigrated() {
  if (done) return;
  if (await redis(['GET', 'orders:migrated'])) { done = true; return; }
  if (!(await redis(['SET', 'orders:mig-lock', '1', 'NX', 'EX', '120']))) return;   // another request is already doing it
  const old = (await dbGet('orders', [])) || [];
  for (let i = 0; i < old.length; i += 50) {
    const cmds = [];
    for (const o of old.slice(i, i + 50)) {
      const { cmds: c, phoneList } = filing(o);
      cmds.push(...c, ['RPUSH', LIST, o.id]);      // after the orders placed since the new version went live (they are newer)
      if (phoneList) cmds.push(['RPUSH', phoneList, o.id]);
    }
    await pipe(cmds);
  }
  await dbSet('orders:migrated', 1);
  done = true;
}

module.exports = { phoneKey, numberKey, saveOrder, updateOrder, removeOrder, getOrder, listOrders, ordersByPhone, orderByNumber, nextNumber, ensureMigrated };
