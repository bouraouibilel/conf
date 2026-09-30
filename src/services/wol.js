const dgram = require('dgram');

/**
 * Send a Wake-on-LAN magic packet to a target MAC address
 * @param {string} mac - MAC address in format AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF
 * @param {string} broadcastIp - Broadcast IP, default 255.255.255.255
 * @param {number} port - UDP port, default 9
 */
function sendWakeOnLan(mac, broadcastIp = '255.255.255.255', port = 9) {
  return new Promise((resolve, reject) => {
    const cleanMac = mac.replace(/[^0-9a-fA-F]/g, '');
    if (cleanMac.length !== 12) {
      return reject(new Error('Format d\'adresse MAC invalide (attendu 12 caractères hexadécimaux)'));
    }

    const macBuffer = Buffer.from(cleanMac, 'hex');
    // Magic packet: 6 bytes of 0xFF followed by MAC repeated 16 times (total 102 bytes)
    const magicPacket = Buffer.alloc(102);
    magicPacket.fill(0xff, 0, 6);

    for (let i = 0; i < 16; i++) {
      macBuffer.copy(magicPacket, 6 + i * 6);
    }

    const client = dgram.createSocket('udp4');
    client.bind(() => {
      client.setBroadcast(true);
      client.send(magicPacket, 0, magicPacket.length, port, broadcastIp, (err) => {
        client.close();
        if (err) return reject(err);
        resolve({ success: true, message: `Paquet magique Wake-on-LAN envoyé à ${mac}` });
      });
    });
  });
}

module.exports = {
  sendWakeOnLan
};
