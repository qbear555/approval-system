'use strict';

const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');
const {
  translateSql,
  splitStatements,
  matchPragmaTableInfo,
  matchSqliteMasterTable,
  matchPragma,
  mysqlPragmaTableInfoSql,
  normalizeParams,
} = require('./dialect');

const fs = require('fs');

function ensureEnvLoaded() {
  if (process.env.MYSQL_HOST) return;
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  }
}

function parseMysqlConfig() {
  ensureEnvLoaded();
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
  if (/^mysql:\/\//i.test(url)) {
    const u = new URL(url);
    return {
      host: u.hostname || '127.0.0.1',
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username || 'root'),
      password: decodeURIComponent(u.password || ''),
      database: String(u.pathname || '/approval').replace(/^\//, '') || 'approval',
    };
  }
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'approval',
  };
}

let mysqlPromise;
try {
  mysqlPromise = require('mysql2/promise');
} catch {
  mysqlPromise = null;
}

function flattenParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) {
    return normalizeParams(args[0]);
  }
  return normalizeParams(args);
}

function openMysql(config) {
  const cfg = config || parseMysqlConfig();
  const readyBuf = new SharedArrayBuffer(4);
  const ready = new Int32Array(readyBuf);
  const worker = new Worker(path.join(__dirname, 'mysql-worker.js'), {
    workerData: { ...cfg, readyLock: readyBuf },
  });
  worker.on('error', (err) => {
    console.error('[db:mysql] worker', err.message);
    Atomics.store(ready, 0, 1);
    Atomics.notify(ready, 0);
  });
  worker.on('exit', (code) => {
    if (Atomics.load(ready, 0) === 0) {
      Atomics.store(ready, 0, 1);
      Atomics.notify(ready, 0);
    }
    if (code) console.error('[db:mysql] worker exit', code);
  });
  if (Atomics.wait(ready, 0, 0, 8000) === 'timed-out') {
    throw new Error('MySQL worker 啟動逾時');
  }

  // 主執行緒連線池（提供高效能非阻塞非同步查詢）
  let pool = null;
  if (mysqlPromise) {
    try {
      pool = mysqlPromise.createPool({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        database: String(cfg.database || 'approval').replace(/[^A-Za-z0-9_]/g, '') || 'approval',
        waitForConnections: true,
        connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 15),
        queueLimit: 0,
        timezone: '+08:00',
        dateStrings: true,
        decimalNumbers: true,
        charset: 'utf8mb4',
        supportBigNumbers: true,
        bigNumberStrings: false,
        connectTimeout: 8000,
      });
    } catch (err) {
      console.warn('[db:mysql] 主執行緒連線池初始化警告：', err.message);
    }
  }

  function call(method, payload = {}) {
    const { port1, port2 } = new MessageChannel();
    const lockBuf = new SharedArrayBuffer(4);
    const lock = new Int32Array(lockBuf);
    Atomics.store(lock, 0, 0);
    worker.postMessage({ method, lock, port: port2, ...payload }, [port2]);
    const wait = Atomics.wait(lock, 0, 0, 20000);
    const msg = receiveMessageOnPort(port1);
    port1.close();
    if (wait === 'timed-out') {
      throw new Error('MySQL 查詢逾時');
    }
    if (!msg || !msg.message) throw new Error('MySQL worker 無回應');
    if (msg.message.error) {
      const e = new Error(msg.message.error);
      e.code = msg.message.code;
      throw e;
    }
    return msg.message.result;
  }

  function execRaw(sql) {
    if (!sql || !String(sql).trim()) return;
    call('exec', { sql });
  }

  const db = {
    client: 'mysql',
    filename: null,
    mysql: cfg,
    pool,
    execRaw(sql) {
      const pragma = matchPragma(sql);
      if (pragma) {
        if (pragma.kind === 'fk') {
          execRaw(pragma.on ? 'SET FOREIGN_KEY_CHECKS=1' : 'SET FOREIGN_KEY_CHECKS=0');
        }
        return;
      }
      const parts = splitStatements(sql);
      for (const part of parts) {
        const p = matchPragma(part);
        if (p) {
          if (p.kind === 'fk') {
            execRaw(p.on ? 'SET FOREIGN_KEY_CHECKS=1' : 'SET FOREIGN_KEY_CHECKS=0');
          }
          continue;
        }
        execRaw(part);
      }
    },
    exec(sql) {
      const pragma = matchPragma(sql);
      if (pragma) {
        db.execRaw(sql);
        return;
      }
      db.execRaw(translateSql(sql, 'mysql'));
    },
    prepare(sql) {
      const tableInfo = matchPragmaTableInfo(sql);
      if (tableInfo) {
        const q = mysqlPragmaTableInfoSql(tableInfo);
        return {
          all: () => call('all', { sql: q, params: [] }) || [],
          get: () => call('get', { sql: q, params: [] }),
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          allAsync: async () => {
            if (!pool) return call('all', { sql: q, params: [] }) || [];
            const [rows] = await pool.query(q);
            return rows || [];
          },
          getAsync: async () => {
            if (!pool) return call('get', { sql: q, params: [] });
            const [rows] = await pool.query(q);
            return rows[0];
          },
          runAsync: async () => ({ changes: 0, lastInsertRowid: 0 }),
        };
      }
      const master = matchSqliteMasterTable(sql);
      if (master) {
        const showCreateAsync = async () => {
          if (!pool) return call('showCreate', { table: master }) || '';
          const [rows] = await pool.query(`SHOW CREATE TABLE \`${String(master).replace(/[^A-Za-z0-9_]/g, '')}\``);
          return rows[0] && rows[0]['Create Table'] ? rows[0]['Create Table'] : '';
        };
        return {
          get: () => ({ sql: call('showCreate', { table: master }) || '' }),
          all: () => [{ sql: call('showCreate', { table: master }) || '' }],
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          getAsync: async () => ({ sql: await showCreateAsync() }),
          allAsync: async () => [{ sql: await showCreateAsync() }],
          runAsync: async () => ({ changes: 0, lastInsertRowid: 0 }),
        };
      }
      const translated = translateSql(sql, 'mysql');
      return {
        run: (...args) => {
          const result = call('run', { sql: translated, params: flattenParams(args) });
          return {
            changes: Number(result?.changes || 0),
            lastInsertRowid: Number(result?.lastInsertRowid || 0),
          };
        },
        get: (...args) => call('get', { sql: translated, params: flattenParams(args) }),
        all: (...args) => call('all', { sql: translated, params: flattenParams(args) }) || [],
        runAsync: async (...args) => {
          const norm = flattenParams(args);
          if (!pool) {
            const result = call('run', { sql: translated, params: norm });
            return {
              changes: Number(result?.changes || 0),
              lastInsertRowid: Number(result?.lastInsertRowid || 0),
            };
          }
          const [res] = await pool.execute(translated, norm);
          return {
            changes: Number(res?.affectedRows || 0),
            lastInsertRowid: Number(res?.insertId || 0),
          };
        },
        getAsync: async (...args) => {
          const norm = flattenParams(args);
          if (!pool) return call('get', { sql: translated, params: norm });
          const [rows] = await pool.execute(translated, norm);
          return rows[0];
        },
        allAsync: async (...args) => {
          const norm = flattenParams(args);
          if (!pool) return call('all', { sql: translated, params: norm }) || [];
          const [rows] = await pool.execute(translated, norm);
          return rows || [];
        },
      };
    },

    // 直接快捷非同步方法（非阻塞 Event Loop）
    async queryAsync(sql, params = []) {
      const translated = translateSql(sql, 'mysql');
      const norm = flattenParams(Array.isArray(params) ? params : [params]);
      if (!pool) return call('all', { sql: translated, params: norm }) || [];
      const [rows] = await pool.query(translated, norm);
      return rows;
    },
    async getAsync(sql, ...args) {
      return db.prepare(sql).getAsync(...args);
    },
    async allAsync(sql, ...args) {
      return db.prepare(sql).allAsync(...args);
    },
    async runAsync(sql, ...args) {
      return db.prepare(sql).runAsync(...args);
    },
    async execAsync(sql) {
      if (!sql || !String(sql).trim()) return;
      if (!pool) {
        db.exec(sql);
        return;
      }
      const pragma = matchPragma(sql);
      if (pragma) {
        if (pragma.kind === 'fk') {
          await pool.query(pragma.on ? 'SET FOREIGN_KEY_CHECKS=1' : 'SET FOREIGN_KEY_CHECKS=0');
        }
        return;
      }
      const parts = splitStatements(sql);
      for (const part of parts) {
        const p = matchPragma(part);
        if (p) {
          if (p.kind === 'fk') {
            await pool.query(p.on ? 'SET FOREIGN_KEY_CHECKS=1' : 'SET FOREIGN_KEY_CHECKS=0');
          }
          continue;
        }
        await pool.query(translateSql(part, 'mysql'));
      }
    },
    async withTransaction(callback) {
      if (!pool) {
        // Fallback for environment without pool
        db.exec('START TRANSACTION');
        try {
          const res = await callback(db);
          db.exec('COMMIT');
          return res;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const tx = {
          query: (s, p) => conn.query(translateSql(s, 'mysql'), flattenParams(p || [])),
          execute: (s, p) => conn.execute(translateSql(s, 'mysql'), flattenParams(p || [])),
          getAsync: async (s, ...p) => {
            const [rows] = await conn.execute(translateSql(s, 'mysql'), flattenParams(p));
            return rows[0];
          },
          allAsync: async (s, ...p) => {
            const [rows] = await conn.execute(translateSql(s, 'mysql'), flattenParams(p));
            return rows || [];
          },
          runAsync: async (s, ...p) => {
            const [res] = await conn.execute(translateSql(s, 'mysql'), flattenParams(p));
            return {
              changes: Number(res?.affectedRows || 0),
              lastInsertRowid: Number(res?.insertId || 0),
            };
          },
        };
        const result = await callback(tx);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },

    checkpoint() {},
    async closeAsync() {
      try {
        call('close');
      } catch {
        /* ignore */
      }
      worker.terminate();
      if (pool) await pool.end().catch(() => {});
    },
    close() {
      try {
        call('close');
      } catch {
        /* ignore */
      }
      worker.terminate();
      if (pool) pool.end().catch(() => {});
    },
  };

  return db;
}

module.exports = { openMysql, parseMysqlConfig };
