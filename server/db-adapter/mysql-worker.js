'use strict';

const { parentPort, workerData } = require('worker_threads');

let mysql;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  parentPort.on('message', ({ lock, port }) => {
    port.postMessage({ error: '尚未安裝 mysql2，請執行 npm install mysql2', code: 'MODULE_NOT_FOUND' });
    const { Atomics } = global;
    Atomics.store(lock, 0, 1);
    Atomics.notify(lock, 0);
  });
  throw e;
}

let pool;

async function getPool() {
  if (pool) return pool;
  const cfg = workerData || {};
  const dbName = String(cfg.database || 'approval').replace(/[^A-Za-z0-9_]/g, '') || 'approval';

  let initConn;
  try {
    initConn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 8000,
    });
    await initConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (e) {
    if (!/ER_DBACCESS_DENIED|ER_SPECIFIC_ACCESS_DENIED|ER_DB_CREATE_EXISTS/i.test(e.code || e.message || '')) {
      console.warn('[db:mysql-worker] create db warning:', e.message);
    }
  } finally {
    if (initConn) await initConn.end().catch(() => {});
  }

  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    timezone: '+08:00',
    dateStrings: true,
    decimalNumbers: true,
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectTimeout: 8000,
  });

  return pool;
}

(async () => {
  try {
    const p = await getPool();
    await p.query('SELECT 1');
  } catch (err) {
    console.error('[db:mysql-worker] pool startup error:', err.message);
  } finally {
    if (workerData && workerData.readyLock) {
      const lock = new Int32Array(workerData.readyLock);
      Atomics.store(lock, 0, 1);
      Atomics.notify(lock, 0);
    }
  }
})();

parentPort.on('message', async (msg) => {
  const { method, sql, params, lock, port, table } = msg;
  try {
    const p = await getPool();
    let result;
    if (method === 'exec') {
      if (sql && String(sql).trim()) await p.query(sql);
      result = { ok: true };
    } else if (method === 'run') {
      const [res] = await p.execute(sql, params || []);
      result = {
        changes: Number(res.affectedRows || 0),
        lastInsertRowid: Number(res.insertId || 0),
      };
    } else if (method === 'get') {
      const [rows] = await p.execute(sql, params || []);
      result = rows[0];
    } else if (method === 'all') {
      const [rows] = await p.execute(sql, params || []);
      result = rows;
    } else if (method === 'showCreate') {
      const [rows] = await p.query(`SHOW CREATE TABLE \`${String(table).replace(/[^A-Za-z0-9_]/g, '')}\``);
      result = rows[0] && rows[0]['Create Table'] ? rows[0]['Create Table'] : '';
    } else if (method === 'close') {
      if (pool) await pool.end().catch(() => {});
      pool = null;
      result = { ok: true };
    } else {
      throw new Error('未知 MySQL worker 方法：' + method);
    }
    port.postMessage({ result });
  } catch (e) {
    port.postMessage({ error: e.message || String(e), code: e.code });
  } finally {
    Atomics.store(lock, 0, 1);
    Atomics.notify(lock, 0);
  }
});
