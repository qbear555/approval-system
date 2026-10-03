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

let conn;

async function getConn() {
  if (conn) return conn;
  const cfg = workerData || {};
  conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    multipleStatements: true,
    timezone: '+08:00',
    dateStrings: true,
    decimalNumbers: true,
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectTimeout: 8000,
  });
  await conn.query("SET time_zone = '+08:00'");
  await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
  const dbName = String(cfg.database || 'approval').replace(/[^A-Za-z0-9_]/g, '');
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (e) {
    if (!/ER_DBACCESS_DENIED|ER_SPECIFIC_ACCESS_DENIED|ER_DB_CREATE_EXISTS/i.test(e.code || e.message || '')) {
      throw e;
    }
  }
  await conn.query(`USE \`${dbName}\``);
  return conn;
}

if (workerData && workerData.readyLock) {
  const lock = new Int32Array(workerData.readyLock);
  Atomics.store(lock, 0, 1);
  Atomics.notify(lock, 0);
}

parentPort.on('message', async (msg) => {
  const { method, sql, params, lock, port, table } = msg;
  try {
    const c = await getConn();
    let result;
    if (method === 'exec') {
      if (sql && String(sql).trim()) await c.query(sql);
      result = { ok: true };
    } else if (method === 'run') {
      const [res] = await c.execute(sql, params || []);
      result = {
        changes: Number(res.affectedRows || 0),
        lastInsertRowid: Number(res.insertId || 0),
      };
    } else if (method === 'get') {
      const [rows] = await c.execute(sql, params || []);
      result = rows[0];
    } else if (method === 'all') {
      const [rows] = await c.execute(sql, params || []);
      result = rows;
    } else if (method === 'showCreate') {
      const [rows] = await c.query(`SHOW CREATE TABLE \`${String(table).replace(/[^A-Za-z0-9_]/g, '')}\``);
      result = rows[0] && rows[0]['Create Table'] ? rows[0]['Create Table'] : '';
    } else if (method === 'close') {
      if (conn) await conn.end();
      conn = null;
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
