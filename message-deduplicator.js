export class MessageDeduplicator {
  constructor({ ttlMs = 120_000, maxEntries = 10_000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.seen = new Map();
  }

  async dispatch(handler, message) {
    const key = message?.key;
    if (!key?.remoteJid || !key?.id) return handler.handleMessage(message);

    const now = this.now();
    for (const [id, timestamp] of this.seen) {
      if (now - timestamp < this.ttlMs) break;
      this.seen.delete(id);
    }

    const id = `${key.remoteJid}\0${key.id}`;
    if (this.seen.has(id)) return false;

    this.seen.set(id, now);
    while (this.seen.size > this.maxEntries) {
      this.seen.delete(this.seen.keys().next().value);
    }

    await handler.handleMessage(message);
    return true;
  }
}
