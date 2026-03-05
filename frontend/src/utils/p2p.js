// Hardened WebRTC P2P helper

let peer = null;
let channel = null;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" }
  ]
};

// ==============================
// CREATE CONNECTION (Student)
// ==============================
export function createConnection(onReceive, onChannelOpen) {
  peer = new RTCPeerConnection(rtcConfig);

  channel = peer.createDataChannel("secure-file", {
    ordered: true
  });

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

  return peer;
}

// ==============================
// ACCEPT CONNECTION (Shop)
// ==============================
export function acceptConnection(onReceive, onChannelOpen) {
  peer = new RTCPeerConnection(rtcConfig);

  peer.ondatachannel = (event) => {
    channel = event.channel;
    console.log("[Shop] DataChannel received! Label:", channel.label, "State:", channel.readyState);

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
export function waitForIceGathering(pc, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }

    let timeoutHandle = setTimeout(() => {
      resolve(); // Resolve after timeout
    }, timeoutMs);

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeoutHandle);
        resolve();
      }
    };
  });
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