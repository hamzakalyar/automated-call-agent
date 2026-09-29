import localtunnel from 'localtunnel';

async function startTunnel() {
  const port = process.env.PORT || 3000;
  console.log(`[Tunnel] Connecting localtunnel to port ${port}...`);
  
  try {
    const tunnel = await localtunnel({ port });
    console.log(`=======================================================`);
    console.log(`[Tunnel Active] Public Webhook URL:`);
    console.log(`${tunnel.url}/api/webhooks/vapi`);
    console.log(`=======================================================`);

    tunnel.on('close', () => {
      console.log('[Tunnel] Tunnel closed. Reconnecting in 3s...');
      setTimeout(startTunnel, 3000);
    });

    tunnel.on('error', (err) => {
      console.error('[Tunnel Error]', err.message);
      setTimeout(startTunnel, 3000);
    });

    // Keep process alive indefinitely
    setInterval(() => {}, 1000 * 60 * 60);
  } catch (err) {
    console.error('[Tunnel Failed to Start]', err.message);
    setTimeout(startTunnel, 3000);
  }
}

startTunnel();
