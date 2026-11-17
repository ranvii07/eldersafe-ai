// Tiny storage layer. Uses Vercel Blob when a Blob store is connected to the project
// (BLOB_STORE_ID with Vercel's OIDC auth, or a BLOB_READ_WRITE_TOKEN). Without it, data is kept
// in memory so the app still runs, but it resets when the server restarts.
// Each record is its own small JSON file (append-only).
import { put, list, del, get } from '@vercel/blob';

const useBlob = () => !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
const mem = (globalThis.__eldersafe ||= { contacts: [], alerts: [], model: [] });
let access = 'private'; // works with private stores; switches to 'public' if the store is public

export const storageMode = () => (useBlob() ? 'vercel-blob' : 'memory');

export async function add(kind, obj) {
  const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(), ...obj };
  if (!useBlob()) { mem[kind].push(rec); return rec; }
  const path = `eldersafe/${kind}/${rec.id}.json`, body = JSON.stringify(rec);
  const opts = (a) => ({ access: a, addRandomSuffix: true, contentType: 'application/json' });
  try { await put(path, body, opts(access)); }
  catch (e) { access = access === 'private' ? 'public' : 'private'; await put(path, body, opts(access)); }
  return rec;
}

async function read(url) {
  for (const a of [access, access === 'private' ? 'public' : 'private']) {
    try {
      const r = await get(url, { access: a, useCache: false });
      if (r && r.stream) { access = a; return await new Response(r.stream).json(); }
    } catch (e) { /* try the other access type */ }
  }
  return null;
}

export async function all(kind) {
  if (!useBlob()) return [...mem[kind]];
  const { blobs } = await list({ prefix: `eldersafe/${kind}/`, limit: 1000 });
  const recs = await Promise.all(blobs.map((b) => read(b.url)));
  return recs.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function remove(kind, id) {
  if (!useBlob()) { mem[kind] = mem[kind].filter((r) => r.id !== id); return; }
  const { blobs } = await list({ prefix: `eldersafe/${kind}/${id}`, limit: 10 });
  if (blobs.length) await del(blobs.map((b) => b.url));
}
