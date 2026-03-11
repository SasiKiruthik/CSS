// Hardened WebRTC P2P helper

let peer = null;
let channel = null;
let iceCandidatesLocal = [];
let iceCandidatesRemote = [];

const rtcConfig = {
  iceServers: [
    // Primary STUN servers for NAT traversal (no authentication required)
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun1.l.google.com:19302"] },
    { urls: ["stun:stun2.l.google.com:19302"] },
    { urls: ["stun:stun3.l.google.com:19302"] },
    { urls: ["stun:stun4.l.google.com:19302"] },
    { urls: ["stun:stun5.l.google.com:19302"] },
    { urls: ["stun:stun6.l.google.com:19302"] },
    
    // Backup STUN servers
    { urls: ["stun:stun.services.mozilla.com:3478"] },
    { urls: ["stun:stun.stunprotocol.org:3478"] }
  ],
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require"
};

// ==============================
// CREATE CONNECTION (Student)
// ==============================
export function createConnection(onReceive, onChannelOpen, onIceCandidate, onChannelCreated) {
  peer = new RTCPeerConnection(rtcConfig);
  iceCandidatesLocal = [];
  iceCandidatesRemote = [];

  channel = peer.createDataChannel("secure-file", {
    ordered: true
  });
  
  // Notify that channel was created
  if (onChannelCreated) onChannelCreated(channel);

  channel.onmessage = (event) => {
    console.log("[Student] onmessage received, data type:", typeof event.data);
    onReceive(event.data);
  };

  channel.onopen = () => {
    console.log("[Student] Data channel OPEN!");
    if (onChannelOpen) onChannelOpen();
  };

  channel.onerror = (err) => {
    console.error("[Student] Channel error:", err);
  };

  channel.onclose = () => {
    console.warn("[Student] Channel closed");
  };

  // ICE candidate handling
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("[Student] New ICE candidate:", event.candidate.candidate);
      iceCandidatesLocal.push(event.candidate);
      if (onIceCandidate) onIceCandidate(event.candidate);
    } else {
      console.log("[Student] ICE gathering complete");
    }
  };

  peer.onconnectionstatechange = () => {
    console.log("[Student] Connection state:", peer.connectionState);
  };

  peer.oniceconnectionstatechange = () => {
    console.log("[Student] ICE connection state:", peer.iceConnectionState);
  };

  peer.onicegatheringstatechange = () => {
    console.log("[Student] ICE gathering state:", peer.iceGatheringState);
  };

  return peer;
}

// ==============================
// ACCEPT CONNECTION (Shop)
// ==============================
export function acceptConnection(onReceive, onChannelOpen, onIceCandidate, onChannelCreated) {
  peer = new RTCPeerConnection(rtcConfig);
  iceCandidatesLocal = [];
  iceCandidatesRemote = [];

  peer.ondatachannel = (event) => {
    channel = event.channel;
    console.log("[Shop] DataChannel received! Label:", channel.label, "State:", channel.readyState);
    
    // Notify that channel was created
    if (onChannelCreated) onChannelCreated(channel);

    channel.onmessage = (e) => {
      onReceive(e.data);
    };

    channel.onopen = () => {
      console.log("[Shop] Data channel OPEN!");
      if (onChannelOpen) onChannelOpen();
    };

    channel.onerror = (err) => {
      console.error("[Shop] Channel error:", err);
    };

    channel.onclose = () => {
      console.warn("[Shop] Channel closed");
    };
  };

  // ICE candidate handling
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("[Shop] New ICE candidate:", event.candidate.candidate);
      iceCandidatesLocal.push(event.candidate);
      if (onIceCandidate) onIceCandidate(event.candidate);
    } else {
      console.log("[Shop] ICE gathering complete");
    }
  };

  peer.onconnectionstatechange = () => {
    console.log("[Shop] Connection state:", peer.connectionState);
  };

  peer.oniceconnectionstatechange = () => {
    console.log("[Shop] ICE connection state:", peer.iceConnectionState);
  };

  peer.onicegatheringstatechange = () => {
    console.log("[Shop] ICE gathering state:", peer.iceGatheringState);
  };

  return peer;
}

// ==============================
// SEND DATA SAFELY
// ==============================
export function sendData(data) {
  if (!channel || channel.readyState !== "open") {
    const err = "Data channel not open (state: " + (channel ? channel.readyState : "null") + ")";
    console.error("[P2P] " + err);
    throw new Error(err);
  }

  console.log("[P2P] Sending", data.length || data.byteLength, "bytes");

  // Use larger chunks and intelligent backpressure based on bufferedAmount
  const CHUNK_SIZE = 8192; // 8KB chunks
  if (typeof data === "string" && data.length > CHUNK_SIZE) {
    console.log("[P2P] Chunking into", Math.ceil(data.length / CHUNK_SIZE), "chunks of", CHUNK_SIZE, "bytes");
    
    let chunkIndex = 0;
    const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
    
    const sendNextChunk = () => {
      const start = chunkIndex * CHUNK_SIZE;
      const end = start + CHUNK_SIZE;
      const chunk = data.slice(start, end);
      
      try {
        channel.send(chunk);
        chunkIndex++;
        console.log("[P2P] Sent chunk", chunkIndex, '/', totalChunks);
        
        if (end < data.length) {
          // Only delay if buffer is getting full (>32KB pending)
          // This is much faster than always delaying
          if (channel.bufferedAmount > 32768) {
            console.log("[P2P] Buffer full (" + channel.bufferedAmount + " bytes), waiting...");
            setTimeout(sendNextChunk, 20);
          } else {
            // Send next chunk immediately if buffer has space
            setTimeout(sendNextChunk, 0);
          }
        } else {
          console.log("[P2P] All chunks sent!");
        }
      } catch (err) {
        console.error("[P2P] Send error on chunk", chunkIndex, ":", err);
        throw err;
      }
    };
    
    sendNextChunk();
  } else {
    channel.send(data);
    console.log("[P2P] Sent single payload");
  }
}

// ==============================
// WAIT FOR ICE GATHERING
// ==============================
export function waitForIceGathering(pc, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      console.log("[P2P] ICE already complete, resolving immediately");
      resolve();
      return;
    }

    let timeoutHandle = setTimeout(() => {
      console.log("[P2P] ICE gathering timeout reached, resolving");
      resolve(); // Resolve after timeout
    }, timeoutMs);

    pc.onicegatheringstatechange = () => {
      console.log("[P2P] ICE gathering state change:", pc.iceGatheringState);
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeoutHandle);
        resolve();
      }
    };
  });
}

// ==============================
// GET CONNECTION STATUS
// ==============================
export function getConnectionStatus(pc) {
  if (!pc) return { status: "No peer connection" };
  
  return {
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    iceGatheringState: pc.iceGatheringState,
    signalingState: pc.signalingState,
    localDescription: pc.localDescription ? "Set" : "Not set",
    remoteDescription: pc.remoteDescription ? "Set" : "Not set",
    iceCandidate: `Total candidates: ${iceCandidatesLocal.length}`
  };
}

export function getDataChannelStatus(ch) {
  if (!ch) return { status: "No data channel" };
  
  return {
    readyState: ch.readyState,
    label: ch.label,
    ordered: ch.ordered,
    bufferedAmount: ch.bufferedAmount
  };
}

// ==============================
// ADD REMOTE ICE CANDIDATES
// ==============================
export function addRemoteIceCandidate(candidate) {
  if (peer && candidate) {
    try {
      peer.addIceCandidate(candidate).catch((err) => {
        console.warn("[P2P] Failed to add ICE candidate:", err);
      });
    } catch (err) {
      console.warn("[P2P] Error adding ICE candidate:", err);
    }
  }
}

// ==============================
// CLOSE CONNECTION
// ==============================
export function closeConnection() {
  if (channel) {
    channel.close();
    channel = null;
  }
  if (peer) {
    peer.close();
    peer = null;
  }
}