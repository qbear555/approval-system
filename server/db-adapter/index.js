'use strict';

const { openMysql, parseMysqlConfig } = require('./mysql');
const { applySchema } = require('./schema');
const dialect = require('./dialect');

function resolveClient() {
  return 'mysql';
}

function createDatabase(opts = {}) {
  if (opts.client && String(opts.client).toLowerCase() === 'sqlite') {
    throw new Error('已移除 SQLite 適配層，請使用 MariaDB／MySQL（DB_CLIENT=mysql）');
  }
  const db = openMysql(opts.mysql || parseMysqlConfig());
  applySchema(db);
  const cfg = db.mysql || {};
  console.log(`[db] MySQL ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  return db;
}

module.exports = { createDatabase, resolveClient, dialect };
