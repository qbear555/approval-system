process.env.PORT = process.env.PORT || '3847';
// 時區：真正生效需在行程啟動前設定（見同目錄 .bat）；
// 這裡是保險，讓 Node 端的 Date 至少為台灣時間
process.env.TZ = process.env.TZ || 'Asia/Taipei';
process.env.HTTPS_ENABLED = process.env.HTTPS_ENABLED || '0';
require('./server/index.js');
