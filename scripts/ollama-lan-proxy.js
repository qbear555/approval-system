/**
 * Ollama LAN Proxy
 * 將本機區網 IP (如 192.168.99.100:11434) 的請求透明轉發至 127.0.0.1:11434 (WSL Ollama)
 * 使 NAS 正式環境或其他區網裝置能直接調用本機 RTX 5080 GPU 算力。
 */
const net = require('net');

const LISTEN_PORT = 11434;
const LISTEN_HOST = '0.0.0.0';
const TARGET_PORT = 11434;
const TARGET_HOST = '127.0.0.1';

const server = net.createServer((socket) => {
  socket.setNoDelay(true);
  const client = net.createConnection({ port: TARGET_PORT, host: TARGET_HOST }, () => {
    client.setNoDelay(true);
    socket.pipe(client);
    client.pipe(socket);
  });

  client.on('error', () => {
    socket.destroy();
  });
  socket.on('error', () => {
    client.destroy();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Ollama-LAN-Proxy] 連接埠 ${LISTEN_PORT} 已被佔用，可能已在運行中。`);
  } else {
    console.error('[Ollama-LAN-Proxy] 伺服器錯誤:', err.message);
  }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[Ollama-LAN-Proxy] 已啟動！監聽 ${LISTEN_HOST}:${LISTEN_PORT} -> 轉發至 ${TARGET_HOST}:${TARGET_PORT}`);
});
