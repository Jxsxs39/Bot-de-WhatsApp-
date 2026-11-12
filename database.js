import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const databasePath = path.resolve(process.env.BOT_DATABASE_PATH || './data/bot-database.json');
const emptyDatabase = () => ({ version: 1, users: {} });

/** A small JSON-backed database for persistent per-user bot stats. */
export class Database {
    #data = emptyDatabase();
    #writeQueue = Promise.resolve();

    async init() {
        await mkdir(path.dirname(databasePath), { recursive: true });
        try {
            const contents = await readFile(databasePath, 'utf8');
            const parsed = JSON.parse(contents);
            if (parsed?.version !== 1 || typeof parsed.users !== 'object' || parsed.users === null) {
                throw new Error('Formato de base de datos no válido.');
            }
            this.#data = parsed;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await this.#persist();
        }
        return this;
    }

    async getUser(id) {
        if (!id) throw new TypeError('Se requiere el identificador del usuario.');
        return structuredClone(this.#data.users[id] ?? {
            id,
            messages: 0,
            firstSeenAt: null,
            lastSeenAt: null,
        });
    }

    async recordMessage(id) {
        if (!id) throw new TypeError('Se requiere el identificador del usuario.');
        const now = new Date().toISOString();
        const user = this.#data.users[id] ?? {
            id,
            messages: 0,
            firstSeenAt: now,
            lastSeenAt: now,
        };
        user.messages += 1;
        user.lastSeenAt = now;
        this.#data.users[id] = user;
        await this.#persist();
        return structuredClone(user);
    }

    async #persist() {
        const snapshot = JSON.stringify(this.#data, null, 2);
        this.#writeQueue = this.#writeQueue.then(async () => {
            const temporaryPath = `${databasePath}.tmp`;
            await writeFile(temporaryPath, snapshot, 'utf8');
            await rename(temporaryPath, databasePath);
        });
        return this.#writeQueue;
    }
}

export const database = new Database();
