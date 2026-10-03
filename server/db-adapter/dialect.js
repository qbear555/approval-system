/**
 * 同一套應用 SQL（SQLite 方言）→ 目標引擎。
 * 呼叫端繼續寫 datetime('now','localtime')、INSERT OR IGNORE、ON CONFLICT。
 */

const MYSQL_RESERVED = new Set([
  'comment',
  'read',
  'rank',
  'signal',
  'groups',
  'match',
  'range',
]);

function quoteMysqlIdentifiers(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === q) {
          let b = 0;
          let k = i - 1;
          while (k >= 0 && sql[k] === '\\') {
            b++;
            k--;
          }
          if (b % 2 === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const ident = sql.slice(i, j);
      if (MYSQL_RESERVED.has(ident.toLowerCase())) {
        out += '`' + ident + '`';
      } else {
        out += ident;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function translateSql(sql, dialect) {
  if (!sql || dialect === 'sqlite') return sql;
  let s = String(sql);

  s = s.replace(
    /date\s*\(\s*'now'\s*,\s*'start of month'\s*(,\s*'localtime'\s*)?\)/gi,
    "DATE_FORMAT(NOW(), '%Y-%m-01')"
  );
  s = s.replace(
    /date\s*\(\s*'now'\s*(,\s*'localtime'\s*)?\)/gi,
    'CURDATE()'
  );
  s = s.replace(
    /datetime\s*\(\s*'now'\s*(,\s*'localtime'\s*)?\)/gi,
    "DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')"
  );
  s = s.replace(
    /julianday\s*\(\s*([^)]+?)\s*\)\s*-\s*julianday\s*\(\s*([^)]+?)\s*\)/gi,
    '((UNIX_TIMESTAMP($1) - UNIX_TIMESTAMP($2)) / 86400.0)'
  );
  s = s.replace(/julianday\s*\(\s*([^)]+?)\s*\)/gi, '(UNIX_TIMESTAMP($1) / 86400.0)');
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO');
  s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'REPLACE INTO');
  s = s.replace(/\s+COLLATE\s+NOCASE\b/gi, '');
  s = s.replace(/ESCAPE\s+'\\'/gi, () => "ESCAPE '\\\\'");
  s = quoteMysqlIdentifiers(s);
  s = s.replace(
    /ON\s+CONFLICT\s*\([^)]+\)\s*DO\s+UPDATE\s+SET\s+/gi,
    'ON DUPLICATE KEY UPDATE '
  );
  s = s.replace(/\bexcluded\.([A-Za-z_][A-Za-z0-9_]*)/g, 'VALUES($1)');
  return s;
}

function translateColumnSpec(spec, dialect) {
  if (dialect === 'sqlite') return spec;
  let s = String(spec);
  s = s.replace(/\bINTEGER\b/gi, 'INT');
  s = s.replace(/\bREAL\b/gi, 'DOUBLE');
  s = translateSql(s, 'mysql');
  // MySQL 8 TEXT/BLOB 預設值必須是運算式
  s = s.replace(/DEFAULT\s+'((?:\\'|[^'])*)'/g, "DEFAULT ('$1')");
  return s;
}

function splitStatements(sql) {
  const parts = [];
  let cur = '';
  let inS = false;
  let quote = '';
  const s = String(sql);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) {
      cur += c;
      if (c === quote && s[i - 1] !== '\\') inS = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inS = true;
      quote = c;
      cur += c;
      continue;
    }
    if (c === ';') {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function matchPragmaTableInfo(sql) {
  const m = String(sql).match(
    /^\s*PRAGMA\s+table_info\s*\(\s*["'`]?(\w+)["'`]?\s*\)\s*$/i
  );
  return m ? m[1] : null;
}

function matchSqliteMasterTable(sql) {
  const m = String(sql).match(
    /^\s*SELECT\s+sql\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*'(\w+)'\s*$/i
  );
  return m ? m[1] : null;
}

function matchPragma(sql) {
  const s = String(sql).trim();
  let m = s.match(/^PRAGMA\s+foreign_keys\s*=\s*(ON|OFF)\s*$/i);
  if (m) return { kind: 'fk', on: /^on$/i.test(m[1]) };
  if (/^PRAGMA\s+journal_mode\b/i.test(s)) return { kind: 'noop' };
  if (/^PRAGMA\s+wal_checkpoint\b/i.test(s)) return { kind: 'noop' };
  if (/^PRAGMA\s+foreign_keys\s*$/i.test(s)) return { kind: 'fk_query' };
  return null;
}

function mysqlPragmaTableInfoSql(table) {
  const t = String(table).replace(/[^A-Za-z0-9_]/g, '');
  return (
    `SELECT ORDINAL_POSITION - 1 AS cid, COLUMN_NAME AS name, COLUMN_TYPE AS type, ` +
    `IF(IS_NULLABLE='NO',1,0) AS \`notnull\`, COLUMN_DEFAULT AS dflt_value, ` +
    `IF(COLUMN_KEY='PRI',1,0) AS pk ` +
    `FROM information_schema.COLUMNS ` +
    `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' ` +
    `ORDER BY ORDINAL_POSITION`
  );
}

function normalizeParams(args) {
  return args.map((v) => (v === undefined ? null : v));
}

module.exports = {
  translateSql,
  translateColumnSpec,
  splitStatements,
  matchPragmaTableInfo,
  matchSqliteMasterTable,
  matchPragma,
  mysqlPragmaTableInfoSql,
  normalizeParams,
  quoteMysqlIdentifiers,
};
