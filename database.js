import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export default class Database {
  constructor(filePath = path.resolve('data','bot.db')) {
    this.filePath=filePath;
    this.purchaseQueue=Promise.resolve();
  }
  async init() {
    // SQLite crea el archivo, pero no su carpeta.
    if (this.filePath !== ':memory:') await mkdir(path.dirname(this.filePath), {recursive:true,mode:0o700});
    this.db=await open({filename:this.filePath,driver:sqlite3.Database});
    await this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, messages INTEGER NOT NULL DEFAULT 0,
      coins INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inventory (
      user_id TEXT NOT NULL, item_id TEXT NOT NULL, purchased_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,item_id));
      CREATE TABLE IF NOT EXISTS reward_schema (id INTEGER PRIMARY KEY);`);
    // Migración: conserva los perfiles existentes y agrega columnas nuevas.
    const columns=await this.db.all('PRAGMA table_info(users)');
    for (const name of ['last_work','last_daily','equipped_title']) {
      if (!columns.some(c=>c.name===name)) await this.db.exec('ALTER TABLE users ADD COLUMN '+name+(name.startsWith('last_')?' INTEGER':' TEXT'));
    }
    return this;
  }
  // INSERT OR IGNORE conserva monedas y experiencia de perfiles existentes.
  async ensureUser(id) {
    if (!id) throw new TypeError('Falta usuario');
    const now=new Date().toISOString();
    await this.db.run('INSERT OR IGNORE INTO users (id,firstSeenAt,lastSeenAt) VALUES (?,?,?)',id,now,now);
  }
  // Incremento SQL: evita sobrescribir el contador con una lectura antigua.
  async registerMessage(id) {
    if (!id) throw new TypeError('Falta usuario');
    const now=new Date().toISOString();
    await this.db.run(`INSERT INTO users (id,messages,firstSeenAt,lastSeenAt) VALUES (?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET messages=users.messages+1,lastSeenAt=excluded.lastSeenAt`,id,now,now);
  }
  // Devuelve valores iniciales si todavía no existe un perfil.
  async getStats(id) {
    return await this.db.get('SELECT messages,coins,xp,level,equipped_title FROM users WHERE id=?',id) || {messages:0,coins:0,xp:0,level:1,equipped_title:null};
  }
  // Valida el tipo de premio y usa parámetros SQL para los datos del usuario.
  async claim(id,kind,coins,xp,wait,now=Date.now()) {
    const col={work:'last_work',daily:'last_daily'}[kind];
    if (!['work','daily'].includes(kind) || ![coins,xp,wait,now].every(n=>Number.isSafeInteger(n)&&n>=0)) throw new TypeError('Premio inválido');
    await this.ensureUser(id);
    // Una sola sentencia comprueba el tiempo y entrega todo el premio.
    const result=await this.db.run('UPDATE users SET coins=coins+?,xp=xp+?,level=CAST((xp+?)/100 AS INTEGER)+1,'+col+'=? WHERE id=? AND ('+col+' IS NULL OR '+col+'<=?)',coins,xp,xp,now,id,now-wait);
    if (result.changes) return {ok:true};
    const row=await this.db.get('SELECT '+col+' AS last FROM users WHERE id=?',id);
    return {ok:false,remaining:Math.max(0,row.last+wait-now)};
  }
  async buyItem(id,itemId,price) {
    if(!id||typeof itemId!=='string'||!itemId||!Number.isSafeInteger(price)||price<=0) throw new TypeError('Compra inválida');
    await this.ensureUser(id);
    const previous=this.purchaseQueue;
    let release;
    this.purchaseQueue=new Promise(resolve=>{release=resolve;});
    await previous;
    let inTransaction=false;
    try {
      await this.db.exec('BEGIN IMMEDIATE');
      inTransaction=true;
      const owned=await this.db.get('SELECT 1 AS owned FROM inventory WHERE user_id=? AND item_id=?',id,itemId);
      if(owned) {
        await this.db.exec('ROLLBACK');
        inTransaction=false;
        return {ok:false,reason:'owned'};
      }
      const user=await this.db.get('SELECT coins FROM users WHERE id=?',id);
      if(user.coins<price) {
        await this.db.exec('ROLLBACK');
        inTransaction=false;
        return {ok:false,reason:'funds',coins:user.coins};
      }
      const debit=await this.db.run('UPDATE users SET coins=coins-? WHERE id=? AND coins>=?',price,id,price);
      if(!debit.changes) throw new Error('No se pudo descontar el saldo de la compra');
      await this.db.run('INSERT INTO inventory (user_id,item_id,purchased_at) VALUES (?,?,?)',id,itemId,Date.now());
      const balance=await this.db.get('SELECT coins FROM users WHERE id=?',id);
      await this.db.exec('COMMIT');
      inTransaction=false;
      return {ok:true,coins:balance.coins};
    } catch(error) {
      if(inTransaction) await this.db.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }
  async getInventory(id) {
    const [items,user]=await Promise.all([
      this.db.all('SELECT item_id FROM inventory WHERE user_id=? ORDER BY purchased_at,item_id',id),
      this.getStats(id)
    ]);
    return {items:items.map(item=>item.item_id),equipped:user.equipped_title};
  }
  async equipTitle(id,itemId) {
    await this.ensureUser(id);
    if(itemId!==null) {
      const owned=await this.db.get('SELECT 1 AS owned FROM inventory WHERE user_id=? AND item_id=?',id,itemId);
      if(!owned) return false;
    }
    await this.db.run('UPDATE users SET equipped_title=? WHERE id=?',itemId,id);
    return true;
  }
  // Libera el archivo SQLite al detener el proceso.
  async close() { if(this.db) { await this.db.close(); this.db=null; } }
}
