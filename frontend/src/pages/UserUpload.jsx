import { useState, useRef, useEffect } from "react";
import {
  generatePasscode,
  isPasscodeValid,
  getTimeRemaining,
  deriveKeyFromPasscode,
  encryptFile,
  sha256
} from "../utils/crypto";
import { createConnection, sendData, waitForIceGathering } from "../utils/p2p";

function UserUpload() {
  const [file, setFile] = useState(null);
  const [studentPasscode, setStudentPasscode] = useState(null); // {code, timestamp}
  const [shopPasscode, setShopPasscode] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [status, setStatus] = useState("");
  const [dataChannelStatus, setDataChannelStatus] = useState("No connection");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    setFile(f);

    // compute sha256 fingerprint immediately so it can be shared with shop
    (async () => {
      try {
        const buffer = await f.arrayBuffer();
        const h = await sha256(buffer);
        setFileHash(h);
      } catch (err) {
        console.error("Failed to compute file hash:", err);
        setFileHash("");
      }
    })();
  };

  const peerRef = useRef(null);

  // Countdown timer for passcode validity
  useEffect(() => {
    if (!studentPasscode) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const remaining = getTimeRemaining(studentPasscode);
      setTimeRemaining(remaining);

      if (remaining === 0) {
        setStudentPasscode(null);
        setStatus("⏰ Passcode expired. Generate a new one.");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [studentPasscode]);

  // STEP 1: Generate Student Passcode
  const generateNewPasscode = () => {
    const newPasscode = generatePasscode();
    setStudentPasscode(newPasscode);
    setShopPasscode("");
    setStatus("✓ Passcode generated. Share with shop keeper.");
  };

  // STEP 2: Validate Shop Keeper's Passcode and Auto-Connect
  const connectWithShopPasscode = async () => {
    if (!studentPasscode) {
      alert("Generate your passcode first");
      return;
    }

    if (!isPasscodeValid(studentPasscode)) {
      alert("Your passcode expired. Generate a new one.");
      setStudentPasscode(null);
      return;
    }

    if (!shopPasscode.trim() || !/^\d{6}$/.test(shopPasscode.trim())) {
      alert("Enter shop keeper's 6-digit passcode");
      return;
    }

    try {
      setStatus("✓ Passcode validated! Connection establishing...");
      
      // Create peer connection
      const peer = createConnection(() => {}, () => {
        console.log("[Student] Channel opened!");
        setDataChannelStatus("✓ DataChannel OPEN - connected to shop");
        setIsConnected(true);
        setStatus("✓ Connected! Ready to send file.");
      });
      peerRef.current = peer;

      peer.onicecandidate = (ev) => {
        console.log("[Student] ICE candidate:", ev.candidate);
      };
      peer.oniceconnectionstatechange = () => {
        console.log("[Student] ICE state:", peer.iceConnectionState);
      };
      peer.onconnectionstatechange = () => {
        console.log("[Student] Peer connection state:", peer.connectionState);
        if (peer.connectionState === 'connected') {
          setStatus("✓ Connected! Waiting for data channel...");
        } else if (peer.connectionState === 'failed') {
          setStatus("❌ Connection failed. Ensure shop keeper also entered your code.");
        } else if (peer.connectionState === 'disconnected') {
          setStatus("⚠ Disconnected. Try to connect again.");
        }
      };

      // Create offer
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);

      // Store connection in localStorage for shop keeper to receive
      const connKey = `webrtc_${studentPasscode.code}`;
      localStorage.setItem(connKey, JSON.stringify({
        offer: peer.localDescription,
        studentPasscode: studentPasscode.code,
        timestamp: Date.now()
      }));

      // Poll for answer from shop keeper (faster interval)
      const pollAnswer = setInterval(async () => {
        const answerKey = `webrtc_answer_${studentPasscode.code}`;
        const answerData = localStorage.getItem(answerKey);
        
        if (answerData) {
          clearInterval(pollAnswer);
          try {
            const { answer } = JSON.parse(answerData);
            console.log("[Student] Received answer, setting remote description");
            await peer.setRemoteDescription(answer);
            localStorage.removeItem(answerKey);
            console.log("[Student] Answer set successfully");
          } catch (err) {
            console.error("Failed to set answer:", err);
            setStatus("Connection error: " + err.message);
          }
        }
      }, 200); // Faster polling every 200ms

      // Stop polling after 60 seconds
      setTimeout(() => {
        clearInterval(pollAnswer);
        if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
          setStatus("Connection failed. Make sure shop keeper entered your passcode.");
        }
      }, 60000);

    } catch (err) {
      console.error("Failed to establish connection:", err);
      setStatus("Error: " + err.message);
    }
  };

  // STEP 3: Encrypt & Send
  const handleUpload = async () => {
    if (!file) {
      alert("Select a file first");
      return;
    }
    
    if (!studentPasscode) {
      alert("Generate your passcode first");
      return;
    }

    if (!isPasscodeValid(studentPasscode)) {
      alert("Your passcode expired. Generate a new one.");
      setStudentPasscode(null);
      return;
    }

    if (!isConnected) {
      alert("Not connected to shop. Establish connection first.");
      return;
    }

    try {
      setStatus("Encrypting file...");
      // Convert to ArrayBuffer
      const buffer = await file.arrayBuffer();

      // Generate SHA-256 fingerprint
      const hash = await sha256(buffer);

      // Derive AES-256 key from student's passcode
      const key = await deriveKeyFromPasscode(studentPasscode.code);

      // Encrypt file
      const { encrypted, iv } = await encryptFile(buffer, key);

      // Convert to sendable format
      const payload = {
        fileName: file.name,
        fileSize: file.size,
        encrypted: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv),
        hash
      };

      console.log("[Student] About to send payload, size:", JSON.stringify(payload).length);
      setStatus("Sending encrypted file in chunks...");
      sendData(JSON.stringify(payload));
      console.log("[Student] Payload send initiated!");

      // Wait a bit for all chunks to be sent
      setTimeout(() => {
        setStatus("✓ Encrypted file sent to shop. Share your 6-digit passcode with them to decrypt.");
      }, 2000);
    } catch (err) {
      console.error("[Student] Error during send:", err);
      setStatus("Error: " + err.message);
      alert("Error: " + err.message);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">📱 Secure Upload</h2>

      {/* FILE SELECTION */}
      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 mb-4">
        <label className="block text-sm mb-2">Select File to Print</label>
        <input type="file" onChange={handleFileChange} className="block" />
        {file && (
          <div className="mt-2 text-sm text-slate-300">
            <span className="font-semibold">📄 {file.name}</span>
            <div className="text-xs text-slate-400 mt-1">
              SHA-256: <span className="font-mono">{fileHash || "computing..."}</span>
            </div>
          </div>
        )}
      </div>

      {/* STEP 1: GENERATE PASSCODE */}
      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Step 1: Generate Your Code</h3>
          {studentPasscode && (
            <span className={`text-xs font-bold ${timeRemaining > 60 ? 'text-emerald-400' : timeRemaining > 30 ? 'text-amber-400' : timeRemaining > 0 ? 'text-orange-400' : 'text-red-400'}`}>
              Valid: {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
            </span>
          )}
        </div>
        <button
          onClick={generateNewPasscode}
          className="bg-emerald-500 text-slate-950 px-4 py-2 rounded font-semibold hover:bg-emerald-400"
        >
          🔐 Generate 6-Digit Code
        </button>

        {studentPasscode && (
          <div className="mt-4 p-4 rounded-lg bg-emerald-500/20 border-2 border-emerald-500">
            <p className="text-xs text-emerald-300 mb-2">📤 Share this code with shop keeper:</p>
            <p className="text-4xl font-mono font-bold text-emerald-400 text-center tracking-widest">
              {studentPasscode.code}
            </p>
            <p className="text-xs text-emerald-300 mt-2 text-center">
              Call, SMS, WhatsApp, or tell them in-person
            </p>
          </div>
        )}
      </div>

      {/* STEP 2: ENTER SHOP KEEPER'S CODE */}
      {studentPasscode && isPasscodeValid(studentPasscode) && (
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 mb-4">
          <h3 className="font-semibold mb-2">Step 2: Enter Shop Keeper's Code</h3>
          <p className="text-xs text-slate-400 mb-3">Shop keeper will provide their code after receiving yours</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter 6 digits"
              value={shopPasscode}
              onChange={(e) => setShopPasscode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength="6"
              className="w-40 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-2xl font-mono font-bold text-center"
            />
            <button
              onClick={connectWithShopPasscode}
              className="bg-blue-500 text-slate-950 px-4 py-2 rounded font-semibold hover:bg-blue-400"
            >
              ✓ Connect
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: ENCRYPT & SEND */}
      {isConnected && (
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 mb-4">
          <h3 className="font-semibold mb-2">Step 3: Encrypt & Send File</h3>
          <button
            onClick={handleUpload}
            className="bg-purple-600 text-white px-6 py-2 rounded font-semibold hover:bg-purple-500"
          >
            🚀 Encrypt & Send
          </button>
          <p className="text-xs text-slate-400 mt-2">
            File will be encrypted with your passcode and sent via secure connection
          </p>
        </div>
      )}

      {/* STATUS */}
      {status && (
        <div className="mt-4 p-3 rounded-md bg-slate-800/50 border border-slate-700">
          <p className="text-sm text-slate-300">{status}</p>
        </div>
      )}

      {/* DEBUG */}
      <div className="text-xs text-amber-300 mt-4 p-2 border border-amber-600 rounded bg-slate-900/50">
        <strong>Status:</strong> {dataChannelStatus}
      </div>
    </div>
  );
}

export default UserUpload;