import { list, del } from '@vercel/blob';

const KEEP_DAYS = 30;

// Vercel Cron이 매일 한 번 호출합니다. 30일이 지난 날짜 폴더를 통째로 지웁니다.
export default {
  async fetch(request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    const ua = request.headers.get('user-agent') || '';
    if (secret ? auth !== `Bearer ${secret}` : !ua.startsWith('vercel-cron')) return new Response('Unauthorized', { status: 401 });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: 'no blob token' }, { status: 503 });

    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    let deleted = 0, cursor;
    const old = [];
    do {
      const page = await list({ prefix: 'qr-images/', mode: 'folded', cursor });
      for (const folder of page.folders) {
        const day = folder.slice('qr-images/'.length, -1);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff) old.push(folder);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    for (const folder of old) {
      let c;
      do {
        const page = await list({ prefix: folder, cursor: c, limit: 1000 });
        if (page.blobs.length) { await del(page.blobs.map(b => b.url)); deleted += page.blobs.length; }
        c = page.hasMore ? page.cursor : undefined;
      } while (c);
    }
    return Response.json({ cutoff, folders: old.length, deleted }, { headers: { 'Cache-Control': 'no-store' } });
  }
};
