const os = require('os');
const si = require('systeminformation');

let cachedStaticInfo = null;

async function getStaticSystemInfo() {
  if (cachedStaticInfo) return cachedStaticInfo;

  try {
    const [osInfo, cpuInfo, sys] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.system()
    ]);

    cachedStaticInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      distro: osInfo.distro || os.type(),
      release: osInfo.release || os.release(),
      arch: os.arch(),
      kernel: osInfo.kernel,
      cpuModel: `${cpuInfo.manufacturer || ''} ${cpuInfo.brand || ''}`.trim() || os.cpus()[0]?.model || 'Inconnu',
      cpuCores: cpuInfo.physicalCores || os.cpus().length,
      cpuThreads: cpuInfo.cores || os.cpus().length,
      manufacturer: sys.manufacturer,
      model: sys.model
    };
    return cachedStaticInfo;
  } catch (err) {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      distro: os.type(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model || 'Inconnu',
      cpuCores: os.cpus().length,
      cpuThreads: os.cpus().length
    };
  }
}

async function getLiveMetrics() {
  const [load, mem, fsSize, netStats, uptime] = await Promise.all([
    si.currentLoad().catch(() => ({ currentLoad: 0, cpus: [] })),
    si.mem().catch(() => {
      const total = os.totalmem();
      const free = os.freemem();
      return { total, free, used: total - free, active: total - free, swaptotal: 0, swapused: 0 };
    }),
    si.fsSize().catch(() => []),
    si.networkStats().catch(() => []),
    Promise.resolve(os.uptime())
  ]);

  // Network rx/tx totals
  let netRxSec = 0;
  let netTxSec = 0;
  if (Array.isArray(netStats)) {
    netStats.forEach(n => {
      netRxSec += (n.rx_sec || 0);
      netTxSec += (n.tx_sec || 0);
    });
  }

  // Disk summary
  const disks = fsSize.map(d => ({
    fs: d.fs,
    type: d.type,
    size: d.size,
    used: d.used,
    available: d.available,
    use: d.use,
    mount: d.mount
  }));

  return {
    timestamp: Date.now(),
    uptime,
    cpu: {
      usagePercent: Math.round(load.currentLoad * 10) / 10,
      cores: (load.cpus || []).map(c => Math.round(c.load * 10) / 10)
    },
    memory: {
      total: mem.total,
      used: mem.used || (mem.total - mem.free),
      free: mem.free,
      active: mem.active || mem.used,
      usagePercent: Math.round(((mem.used || (mem.total - mem.free)) / mem.total) * 1000) / 10,
      swapTotal: mem.swaptotal || 0,
      swapUsed: mem.swapused || 0,
      swapPercent: mem.swaptotal ? Math.round((mem.swapused / mem.swaptotal) * 1000) / 10 : 0
    },
    disks,
    network: {
      rxSec: netRxSec,
      txSec: netTxSec
    }
  };
}

async function getProcessList(limit = 30) {
  try {
    const processes = await si.processes();
    const sorted = (processes.list || [])
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, limit)
      .map(p => ({
        pid: p.pid,
        name: p.name,
        cpu: Math.round(p.cpu * 10) / 10,
        mem: Math.round(p.mem * 10) / 10,
        user: p.user,
        state: p.state,
        command: p.command
      }));

    return {
      all: processes.all,
      running: processes.running,
      blocked: processes.blocked,
      sleeping: processes.sleeping,
      list: sorted
    };
  } catch (err) {
    return { all: 0, running: 0, blocked: 0, sleeping: 0, list: [] };
  }
}

module.exports = {
  getStaticSystemInfo,
  getLiveMetrics,
  getProcessList
};
