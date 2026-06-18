// Pi Worker - entry point
// Full implementation in pi-worker task
// For now, this is a placeholder that will be spawned by utilityProcess

process.parentPort?.on('message', (msg: any) => {
  if (msg.type === 'ping') {
    process.parentPort?.postMessage({ type: 'pong' })
  }
})
