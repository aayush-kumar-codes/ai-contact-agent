/**
 * PM2 production config. On EC2, prefer `next start` (not `next dev`) and `NODE_ENV=production`.
 * Burstable t2/t3 instances throttle when CPU credits run out; use t3 Unlimited or m6i/c7g for steady load.
 */
module.exports = {
  apps: [
    {
      name: 'contact-agent-api',
      cwd: __dirname,
      script: 'src/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'contact-agent-frontend',
      cwd: `${__dirname}/frontend`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
