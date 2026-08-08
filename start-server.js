process.env.PORT = process.env.PORT || '3847';
process.env.HTTPS_ENABLED = process.env.HTTPS_ENABLED || '0';
require('./server/index.js');
