// POST /api/alert {source, posture, torsoAngle, boxRatio}
// Called by the front end when the model flags a fall. Looks up every saved relative,
// emails them (if Gmail is configured) and stores the alert in history.
// GET /api/alert -> alert history
import nodemailer from 'nodemailer';
import { add, all, storageMode } from '../lib/store.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const alerts = (await all('alerts')).reverse();
      return res.json({ storage: storageMode(), alerts });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = req.body || {};
    const contacts = await all('contacts');
    const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const text = `ElderSafe AI: possible FALL detected at ${time} (source: ${b.source || 'camera'}). ` +
      `Please check on them immediately. This is an automated alert from a student prototype.`;

    let emailStatus = 'not configured';
    const withEmail = contacts.filter((c) => c.email);
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD && withEmail.length) {
      try {
        const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
        await t.sendMail({ from: `ElderSafe AI <${process.env.GMAIL_USER}>`, to: withEmail.map((c) => c.email).join(','),
          subject: 'URGENT: possible fall detected', text });
        emailStatus = `sent to ${withEmail.length}`;
      } catch (e) { emailStatus = 'failed: ' + e.message; }
    } else if (!withEmail.length) emailStatus = 'no contact has an email';

    const alert = await add('alerts', {
      source: b.source || 'camera', posture: b.posture || 'lying',
      torsoAngle: b.torsoAngle ?? null, boxRatio: b.boxRatio ?? null,
      notified: contacts.map((c) => ({ name: c.name, relation: c.relation, phone: c.phone, email: c.email, address: c.address })),
      emailStatus, message: text,
    });
    res.status(201).json(alert);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
