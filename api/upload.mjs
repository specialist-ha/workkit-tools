import { put, list, del } from '@vercel/blob';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

const MAX = 4 * 1024 * 1024;
const SITE_DAILY = 100;          // 사이트 전체 하루 업로드 한도
const IP_DAILY = 20;             // IP당 하루 한도
const IP_BURST = 5;              // IP당 10분 한도
const BURST_MS = 10 * 60 * 1000;
const PATH_RE = /^qr-images\/\d{4}-\d{2}-\d{2}\/(?:[a-f0-9]{12}-)?[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;

const reply = (data, status = 200, extra = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
const hmac = value => createHmac('sha256', process.env.BLOB_READ_WRITE_TOKEN).update(value).digest('hex');
const clientIp = req =>
  (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

function detect(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['image/png', 'png'];
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg'];
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return ['image/gif', 'gif'];
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  return null;
}

export default {
  async fetch(request) {
    const method = request.method;
    if (!['POST', 'DELETE'].includes(method)) return reply({ error: '지원하지 않는 요청입니다.' }, 405);
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return reply({ error: '이 사이트에서 업로드해주세요.' }, 403);
    if (!process.env.BLOB_READ_WRITE_TOKEN) return reply({ error: '저장소 연결을 확인 중입니다. 잠시 후 다시 시도하세요.' }, 503);

    try {
      if (method === 'DELETE') {
        const { pathname, deleteKey } = await request.json();
        if (typeof pathname !== 'string' || !PATH_RE.test(pathname) || typeof deleteKey !== 'string' || !/^[a-f0-9]{64}$/.test(deleteKey))
          return reply({ error: '삭제 정보가 올바르지 않습니다.' }, 400);
        if (!timingSafeEqual(Buffer.from(hmac(pathname), 'hex'), Buffer.from(deleteKey, 'hex')))
          return reply({ error: '삭제 권한을 확인할 수 없습니다.' }, 403);
        await del(pathname);
        return reply({ deleted: true });
      }

      if (Number(request.headers.get('content-length')) > MAX) return reply({ error: '이미지는 4MB까지 올릴 수 있습니다.' }, 413);

      // 하루 단위 폴더 + IP 해시 태그(원본 IP는 저장하지 않음)
      const day = new Date().toISOString().slice(0, 10);
      const prefix = `qr-images/${day}/`;
      const tag = hmac(`ip:${day}:${clientIp(request)}`).slice(0, 12);
      const { blobs } = await list({ prefix, limit: SITE_DAILY });
      if (blobs.length >= SITE_DAILY) return reply({ error: '오늘 업로드 한도에 도달했습니다. 내일 다시 시도하세요.' }, 429);
      const mine = blobs.filter(b => b.pathname.startsWith(prefix + tag + '-'));
      if (mine.length >= IP_DAILY) return reply({ error: '오늘 업로드 가능 횟수를 모두 사용했습니다.' }, 429);
      const recent = mine.filter(b => Date.now() - new Date(b.uploadedAt).getTime() < BURST_MS).length;
      if (recent >= IP_BURST) return reply({ error: '잠시 후 다시 시도하세요. (10분에 5장까지)' }, 429, { 'Retry-After': '600' });

      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX) return reply({ error: '이미지는 4MB까지 올릴 수 있습니다.' }, 413);
      const kind = detect(bytes);
      if (!kind) return reply({ error: 'JPG, PNG, GIF, WEBP 이미지만 올릴 수 있습니다.' }, 415);

      const pathname = `${prefix}${tag}-${randomUUID()}.${kind[1]}`;
      const blob = await put(pathname, bytes, { access: 'public', contentType: kind[0], addRandomSuffix: false, cacheControlMaxAge: 60 });
      return reply({ url: blob.url, pathname, deleteKey: hmac(pathname) });
    } catch {
      return reply({ error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.' }, 500);
    }
  }
};
