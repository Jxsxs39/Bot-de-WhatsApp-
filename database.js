import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export default class Database {
  constructor(filePath = path.resolve('data','bot.db')) { this.filePath=filePath; }
  async init() {
    // SQLite crea el archivo, pero no su carpeta.
    if (this.filePath !== ':memory:') await mkdir(path.dirname(this.filePath), {recursive:true,mode:0o700});
    this.db=await open({filename:this.filePath,driver:sqlite3.Database});
    await this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, messages INTEGER NOT NULL DEFAULT 0,
      coins INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reward_schema (id INTEGER PRIMARY KEY);`);
    // Migración: conserva los perfiles existentes y agrega columnas nuevas.
    const columns=await this.db.all('PRAGMA table_info(users)');
    for (const name of ['last_work','last_daily']) {
      if (!columns.some(c=>c.name===name)) await this.db.exec('ALTER TABLE users ADD COLUMN '+name+' INTEGER');
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
    await this.ensureUser(id);
    await this.db.run('UPDATE users SET messages=messages+1,lastSeenAt=? WHERE id=?',new Date().toISOString(),id);
  }
  // Devuelve valores iniciales si todavía no existe un perfil.
  async getStats(id) {
    return await this.db.get('SELECT messages,coins,xp,level FROM users WHERE id=?',id) || {messages:0,coins:0,xp:0,level:1};
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
  // Libera el archivo SQLite al detener el proceso.
  async close() { if(this.db) { await this.db.close(); this.db=null; } }
}
