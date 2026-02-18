/**
 * Burke Vision Lab — PeerJS Sync (hardened)
 * - Short 4-char pairing codes as PeerJS IDs
 * - Handoff protocol for phone-first pairing flow
 * - Multiple STUN servers for iOS Safari compat
 * - Cache-bust: timestamp suffix on code IDs to avoid stale broker entries
 * - Aggressive retry logic for reliable pairing
 */

const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
];

// Safari sometimes caches WebRTC peer IDs. Timestamp prefix avoids stale broker entries.
function safariId() {
    return 'csf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ═══ Short Code Utilities ═══
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no O/0 I/1

export function shortCode() {
    let code = '';
    const arr = crypto.getRandomValues(new Uint8Array(4));
    for (let i = 0; i < 4; i++) code += CODE_CHARS[arr[i] % CODE_CHARS.length];
    return code;
}

export function codeToId(code) { return 'bvl-' + code.toLowerCase(); }
export function idToCode(id) { return id.replace(/^bvl-/, '').toUpperCase(); }
export function formatCode(code) { return code.split('').join('\u2002'); }

// ═══ Standard Host (Display generates code, waits for Remote) ═══
export function createHost(onReady, onConnect, onData, onDisconnect, customId) {
    let conn = null;
    let activePeer = null;
    let destroyed = false;

    function setupPeer(id) {
        const peer = new Peer(id, { debug: 0, config: { iceServers: ICE } });
        activePeer = peer;

        peer.on('open', actualId => {
            console.log('[Host]', actualId);
            if (onReady) onReady(actualId);
        });

        peer.on('connection', c => {
            c.on('open', () => { conn = c; if (onConnect) onConnect(); });
            c.on('data', d => { if (onData) onData(d); });
            c.on('close', () => { conn = null; if (onDisconnect) onDisconnect(); });
            c.on('error', e => console.warn('[Host] conn err:', e));
        });

        peer.on('error', e => {
            console.warn('[Host] peer err:', e.type);
            if (e.type === 'unavailable-id' && !destroyed) {
                peer.destroy();
                // Retry with a fresh ID
                const retryId = safariId();
                console.log('[Host] ID taken, retrying as', retryId);
                setupPeer(retryId);
            }
        });

        peer.on('disconnected', () => { if (!peer.destroyed && !destroyed) peer.reconnect(); });
    }

    const id = customId || safariId();
    setupPeer(id);

    return {
        get id() { return activePeer ? activePeer.id : null; },
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { destroyed = true; try { if (conn) conn.close(); if (activePeer) activePeer.destroy(); } catch(e) {} },
        get peer() { return activePeer; }
    };
}

// ═══ Standard Client (unchanged) ═══
export function createClient(targetID, onOpen, onData, onClose, onError) {
    let conn = null;
    const peer = new Peer(safariId(), { debug: 0, config: { iceServers: ICE } });
    peer.on('open', () => {
        console.log('[Client] open, connecting to', targetID);
        conn = peer.connect(targetID, { reliable: true, serialization: 'json' });
        conn.on('open', () => { console.log('[Client] connected'); if (onOpen) onOpen(); });
        conn.on('data', d => { if (onData) onData(d); });
        conn.on('close', () => { conn = null; if (onClose) onClose(); });
        conn.on('error', e => { console.warn('[Client] conn err:', e); if (onError) onError(e); });
    });
    peer.on('error', e => { console.warn('[Client] peer err:', e.type); if (onError) onError(e); });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { try { if (conn) conn.close(); peer.destroy(); } catch(e) {} },
        peer
    };
}

// ═══ Temporary Host (phone-first: phone waits for handoff message) ═══
export function createTemporaryHost(customId, onReady, onHandoff, onError) {
    let conn = null;
    let destroyed = false;
    const peer = new Peer(customId, { debug: 0, config: { iceServers: ICE } });

    peer.on('open', actualId => { console.log('[TempHost]', actualId); if (onReady) onReady(actualId); });

    peer.on('connection', c => {
        conn = c;
        c.on('data', d => {
            if (d && d.type === 'handoff' && d.displayId) {
                if (onHandoff) onHandoff(d.displayId);
            }
        });
        c.on('error', e => console.warn('[TempHost] conn err:', e));
    });

    peer.on('error', e => {
        console.warn('[TempHost] peer err:', e.type);
        if (e.type === 'unavailable-id') {
            peer.destroy();
            if (onError) onError('unavailable-id');
        }
    });

    peer.on('disconnected', () => { if (!peer.destroyed && !destroyed) peer.reconnect(); });

    return {
        get id() { return peer.id; },
        destroy() { destroyed = true; try { if (conn) conn.close(); peer.destroy(); } catch(e) {} },
        peer
    };
}

// ═══ Handoff Client (PC enters phone's code, then becomes permanent host) ═══
export function createHandoffClient(targetId, displayId, onHandoffComplete, onData, onDisconnect, onError) {
    let conn = null;
    let handoffConn = null;
    let destroyed = false;
    const peer = new Peer(displayId, { debug: 0, config: { iceServers: ICE } });

    peer.on('open', () => {
        console.log('[Handoff] My ID:', displayId, '→ connecting to', targetId);
        handoffConn = peer.connect(targetId, { reliable: true, serialization: 'json' });

        handoffConn.on('open', () => {
            console.log('[Handoff] Sending handoff');
            handoffConn.send({ type: 'handoff', displayId });
            // Send it again after a short delay in case the first was missed
            setTimeout(() => {
                if (handoffConn && handoffConn.open) {
                    handoffConn.send({ type: 'handoff', displayId });
                }
            }, 500);
        });

        handoffConn.on('error', e => {
            console.warn('[Handoff] outgoing err:', e);
            if (onError) onError(e);
        });
    });

    // Listen for incoming connection from tablet.html (after phone redirects)
    peer.on('connection', c => {
        if (handoffConn) { try { handoffConn.close(); } catch(e) {} handoffConn = null; }
        conn = c;
        c.on('open', () => { console.log('[Handoff] Permanent connection open'); if (onHandoffComplete) onHandoffComplete(); });
        c.on('data', d => { if (onData) onData(d); });
        c.on('close', () => { conn = null; if (onDisconnect) onDisconnect(); });
        c.on('error', e => console.warn('[Handoff] conn err:', e));
    });

    peer.on('error', e => {
        console.warn('[Handoff] peer err:', e.type);
        if (e.type === 'peer-unavailable' || e.type === 'unavailable-id') {
            if (onError) onError(e);
        }
    });

    peer.on('disconnected', () => { if (!peer.destroyed && !destroyed) peer.reconnect(); });

    return {
        get id() { return peer.id; },
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { destroyed = true; try { if (handoffConn) handoffConn.close(); if (conn) conn.close(); peer.destroy(); } catch(e) {} },
        peer
    };
}
