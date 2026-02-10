/**
 * BurkeCSF — PeerJS Sync (auto-ID, no collisions)
 */
export function createHost(onReady, onConnect, onData, onDisconnect) {
    let conn = null;
    const peer = new Peer(undefined, {
        debug: 1,
        config: { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]}
    });
    peer.on('open', id => { console.log('[Host]', id); if (onReady) onReady(id); });
    peer.on('connection', c => {
        c.on('open', () => { conn = c; if (onConnect) onConnect(); });
        c.on('data', d => { if (onData) onData(d); });
        c.on('close', () => { conn = null; if (onDisconnect) onDisconnect(); });
        c.on('error', e => console.warn('[Host] conn err:', e));
    });
    peer.on('error', e => console.warn('[Host] peer err:', e.type));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
        get id() { return peer.id; },
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { if (conn) conn.close(); peer.destroy(); },
        peer
    };
}
export function createClient(targetID, onOpen, onData, onClose, onError) {
    let conn = null;
    const peer = new Peer(undefined, {
        debug: 1,
        config: { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]}
    });
    peer.on('open', () => {
        conn = peer.connect(targetID, { reliable: true });
        conn.on('open', () => { if (onOpen) onOpen(); });
        conn.on('data', d => { if (onData) onData(d); });
        conn.on('close', () => { conn = null; if (onClose) onClose(); });
        conn.on('error', e => { if (onError) onError(e); });
    });
    peer.on('error', e => { if (onError) onError(e); });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { if (conn) conn.close(); peer.destroy(); },
        peer
    };
}
