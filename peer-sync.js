/**
 * PeerJS Bidirectional Sync
 * =========================
 * Robust connection handling with proper open-state detection.
 */

export function initSync(laneID, callbacks) {
    let activeConn = null;
    let peer = null;

    try {
        peer = new Peer(laneID, {
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });
    } catch (e) {
        console.error('[Sync] Peer creation failed:', e);
        return null;
    }

    peer.on('open', id => {
        console.log('[Sync] Peer registered with ID:', id);
        const path = window.location.pathname;
        const dir  = path.substring(0, path.lastIndexOf('/'));
        const tabletURL = `${window.location.origin}${dir}/tablet.html?id=${id}`;
        if (callbacks.onReady) callbacks.onReady(tabletURL);
    });

    peer.on('connection', conn => {
        console.log('[Sync] Incoming connection from:', conn.peer);

        // CRITICAL: wait for the data channel to fully open
        conn.on('open', () => {
            console.log('[Sync] Data channel open — connected');
            activeConn = conn;
            if (callbacks.onConnect) callbacks.onConnect();
        });

        conn.on('data', data => {
            switch (data.type) {
                case 'input':    if (callbacks.onInput) callbacks.onInput(data.value); break;
                case 'setMode':  if (callbacks.onModeChange) callbacks.onModeChange(data.mode); break;
                case 'settings': if (callbacks.onSettings) callbacks.onSettings(data.key, data.value); break;
                case 'command':  if (callbacks.onCommand) callbacks.onCommand(data.action); break;
            }
        });

        conn.on('close', () => {
            console.log('[Sync] Connection closed');
            activeConn = null;
            if (callbacks.onDisconnect) callbacks.onDisconnect();
        });

        conn.on('error', err => {
            console.error('[Sync] Connection error:', err);
        });
    });

    peer.on('error', err => {
        console.warn('[Sync] Peer error:', err.type, err.message || '');
    });

    peer.on('disconnected', () => {
        console.log('[Sync] Disconnected from signaling server, reconnecting...');
        if (!peer.destroyed) peer.reconnect();
    });

    return {
        sendState(state) {
            if (activeConn && activeConn.open) activeConn.send({ type: 'state', ...state });
        },
        sendProgress(trial, maxTrials) {
            if (activeConn && activeConn.open) activeConn.send({ type: 'progress', trial, maxTrials });
        },
        sendResults(score, rank, detail) {
            if (activeConn && activeConn.open) activeConn.send({ type: 'results', score, rank, detail });
        },
        get connected() { return activeConn && activeConn.open; },
        get peerID() { return peer ? peer.id : null; },
        destroy() {
            if (activeConn) activeConn.close();
            if (peer) peer.destroy();
        }
    };
}
