// Para un VPS con PM2 (mantiene la app encendida y la rearranca sola):
//   npm install -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'cofiba',
      script: 'server/src/index.js',
      env: { NODE_ENV: 'production', PORT: 4000 },
      max_memory_restart: '400M',
    },
  ],
};
