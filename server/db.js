require('./tz');
const { createDatabase } = require('./db-adapter');

/** 資料庫入口：MariaDB／MySQL（同步 prepare/get/all/run） */
module.exports = createDatabase();
