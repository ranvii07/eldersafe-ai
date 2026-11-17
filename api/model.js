// GET /api/model  -> latest saved model thresholds (or null = use built-in defaults)
// POST /api/model {angle, ratio, duration, drop, metrics} -> save model trained on the Evaluate page
import { add, all } from '../lib/store.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const models = await all('model');
      return res.json({ model: models[models.length - 1] || null });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      const num = (v) => (Number.isFinite(+v) ? +v : null);
      const m = { angle: num(b.angle), ratio: num(b.ratio), duration: num(b.duration), drop: num(b.drop),
        trainedOn: num(b.trainedOn), metrics: b.metrics || null };
      if ([m.angle, m.ratio, m.duration, m.drop].some((v) => v == null)) return res.status(400).json({ error: 'Invalid model' });
      return res.status(201).json(await add('model', m));
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
