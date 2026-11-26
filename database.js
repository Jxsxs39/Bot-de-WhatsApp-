import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'bot.db');

export class Database {
  constructor(filePath = DEFAULT_DB_PATH) {
    this.filePath = filePath;
    this.db = null;
  }

  async init() {
    this.db = await open({
      filename: this.filePath,
      driver: sqlite3.Database,
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        messages INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        firstSeenAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL
      );
    `);

    return this;
  }

  async ensureUser(userId) {
    const existing = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);

    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO users (id, messages, coins, xp, level, firstSeenAt, lastSeenAt)
       VALUES (?, 0, 0, 0, 1, ?, ?)`,
      [userId, now, now]
    );

    return await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
  }

  async getUser(userId) {
    if (!userId) throw new TypeError('Se requiere userId.');
    const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (user) return user;

    return {
      id: userId,
      messages: 0,
      coins: 0,
      xp: 0,
      level: 1,
      firstSeenAt: null,
      lastSeenAt: null,
    };
  }

  async registerMessage(userId) {
    if (!userId) throw new TypeError('Se requiere userId.');
    const now = new Date().toISOString();
    await this.ensureUser(userId);
    await this.db.run(
      'UPDATE users SET messages = messages + 1, lastSeenAt = ? WHERE id = ?',
      [now, userId]
    );
    return await this.getUser(userId);
  }

  async addCoins(userId, amount) {
    if (!userId) throw new TypeError('Se requiere userId.');
    await this.ensureUser(userId);
    await this.db.run(
      'UPDATE users SET coins = coins + ? WHERE id = ?',
      [amount, userId]
    );
    return await this.getUser(userId);
  }

  async addXp(userId, amount) {
    if (!userId) throw new TypeError('Se requiere userId.');
    await this.ensureUser(userId);

    await this.db.run(
      'UPDATE users SET xp = xp + ?, level = CAST((xp + ?) / 100 AS INTEGER) + 1 WHERE id = ?',
      [amount, amount, userId]
    );

    return await this.getUser(userId);
  }

  async getStats(userId) {
    const user = await this.getUser(userId);
    return {
      messages: Number(user.messages || 0),
      coins: Number(user.coins || 0),
      xp: Number(user.xp || 0),
      level: Number(user.level || 1),
    };
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}

export default Database;
