// GET /api/contacts            -> list saved relatives
// POST /api/contacts {name, relation, phone, email, address}
// DELETE /api/contacts?id=...
import { add, all, remove, storageMode } from '../lib/store.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.json({ storage: storageMode(), contacts: await all('contacts') });
    if (req.method === 'POST') {
      const b = req.body || {};
      const name = String(b.name || '').trim(), phone = String(b.phone || '').trim();
      if (!name || !phone) return res.status(400).json({ error: 'Name and phone number are required.' });
      const c = await add('contacts', {
        name, phone,
        relation: String(b.relation || '').trim(),
        email: String(b.email || '').trim(),
        address: String(b.address || '').trim(),
      });
      return res.status(201).json(c);
    }
    if (req.method === 'DELETE') { await remove('contacts', String(req.query.id || '')); return res.json({ ok: true }); }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
