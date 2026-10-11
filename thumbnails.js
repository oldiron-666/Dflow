import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Small libvips worker/cache budget: thumbnails must not compete with the gallery.
sharp.concurrency(1);
sharp.cache({memory: 24, files: 0, items: 32});
export function createThumbnailCache(directory, {workers = 2} = {}) {
  const jobs = new Map();
  const waiting = [];
  let active = 0;
  async function acquire() {
    if (active < workers) { active++; return; }
    await new Promise(resolve => waiting.push(resolve));
  }
  function release() {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
  return async function thumbnail(source) {
    const stat = await fs.stat(source);
    // Moving/replacing a source invalidates the derivative without touching it.
    const key = crypto.createHash('sha256').update(JSON.stringify([
      'half-webp-v1', path.resolve(source), stat.size, stat.mtimeMs, stat.ctimeMs
    ])).digest('hex');
    const destination = path.join(directory, `${key}.webp`);
    try { await fs.access(destination); return destination; } catch {}
    if (jobs.has(key)) return jobs.get(key);
    const job = (async () => {
      await acquire();
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.mkdir(directory, {recursive: true});
        const input = sharp(source, {animated: false, limitInputPixels: 100000000});
        const meta = await input.metadata();
        const rotated = [5, 6, 7, 8].includes(meta.orientation);
        const width = rotated ? meta.height : meta.width;
        const height = rotated ? meta.width : meta.height;
        if (!width || !height) throw Error('Cannot read image dimensions');
        await input.autoOrient().resize({
          width: Math.max(1, Math.round(width / 2)),
          height: Math.max(1, Math.round(height / 2)),
          fit: 'fill', withoutEnlargement: true
        }).webp({quality: 82, effort: 2}).toFile(temporary);
        await fs.rename(temporary, destination);
        return destination;
      } finally {
        await fs.rm(temporary, {force: true}).catch(() => {});
        release();
      }
    })();
    jobs.set(key, job);
    try { return await job; } finally { jobs.delete(key); }
  };
}

export async function sendLocalImage(req, res, source, thumbnail) {
  try {
    let file = source;
    if (req.query.thumbnail === '1') {
      try { file = await thumbnail(source); }
      catch (error) {
        // Unsupported/corrupt inputs still use the existing original-image path.
        console.warn('Thumbnail unavailable:', error.message);
      }
    }
    // Revalidate unchanged derivatives (304); a replacement must never show stale pixels.
    res.set('Cache-Control', 'private, no-cache');
    res.sendFile(file, error => {
      if (error && !res.headersSent) res.sendStatus(error.statusCode || 404);
    });
  } catch (error) { if (!res.headersSent) res.sendStatus(error.statusCode || 500); }
}
