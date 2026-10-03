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
        };
      }
      const master = matchSqliteMasterTable(sql);
      if (master) {
        return {
          get: () => ({ sql: call('showCreate', { table: master }) || '' }),
          all: () => [{ sql: call('showCreate', { table: master }) || '' }],
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
        };
      }
      const translated = translateSql(sql, 'mysql');
      return {
        run: (...args) => {
          const result = call('run', { sql: translated, params: normalizeParams(args) });
          return {
            changes: Number(result?.changes || 0),
            lastInsertRowid: Number(result?.lastInsertRowid || 0),
          };
        },
        get: (...args) => call('get', { sql: translated, params: normalizeParams(args) }),
        all: (...args) => call('all', { sql: translated, params: normalizeParams(args) }) || [],
      };
    },
    checkpoint() {},
    close() {
      try {
        call('close');
      } catch {
        /* ignore */
      }
      worker.terminate();
    },
  };

  return db;
}

module.exports = { openMysql, parseMysqlConfig };
