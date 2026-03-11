import { useState, useRef, useEffect } from "react";
import {
  generatePasscode,
  isPasscodeValid,
  getTimeRemaining,
  deriveKeyFromPasscode,
  encryptFile,
  sha256
} from "../utils/crypto";
import { createConnection, sendData, waitForIceGathering, getConnectionStatus, getDataChannelStatus } from "../utils/p2p";

function UserUpload() {
  const [file, setFile] = useState(null);
  const [studentPasscode, setStudentPasscode] = useState(null); // {code, timestamp}
  const [shopPasscode, setShopPasscode] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [status, setStatus] = useState("");
  const [dataChannelStatus, setDataChannelStatus] = useState("No connection");
  const [connectionStatus, setConnectionStatus] = useState("Not connected");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [offerSDP, setOfferSDP] = useState("");
  const [answerSDP, setAnswerSDP] = useState("");
  const [showOfferStep, setShowOfferStep] = useState(false);
  const [showAnswerStep, setShowAnswerStep] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [diagnostics, setDiagnostics] = useState("");

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
  const dataChannelRef = useRef(null);

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

  // STEP 2: Create Offer manually
  const createOfferForShop = async () => {
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
      setStatus("🔄 Validating passcode and creating connection...");
      setConnectionStatus("Initializing...");
      
      // Create peer connection
      const peer = createConnection(
        () => {},
        () => {
          console.log("[Student] Channel opened!");
          setDataChannelStatus("✅ DataChannel OPEN");
          setConnectionStatus("✅ Connected");
          setIsConnected(true);
          setStatus("✅ Connected! Ready to send file.");
        },
        undefined,
        (ch) => {
          console.log("[Student] Data channel created");
          dataChannelRef.current = ch;
        }
      );
      peerRef.current = peer;

      peer.onicecandidate = (ev) => {
        console.log("[Student] ICE candidate:", ev.candidate?.candidate || "gathering...");
      };
      
      peer.oniceconnectionstatechange = () => {
        const state = peer.iceConnectionState;
        console.log("[Student] ICE state:", state);
        
        if (state === "connected" || state === "completed") {
          setConnectionStatus("🔗 ICE Connected - Waiting for data channel...");
        } else if (state === "checking") {
          setConnectionStatus("🔍 Checking connection...");
        } else if (state === "failed") {
          setConnectionStatus("❌ ICE Connection Failed");
          setStatus("❌ Connection failed. Ensure you entered correct passcode and try again.");
        } else if (state === "disconnected") {
          setConnectionStatus("⚠️ ICE Disconnected");
        }
      };
      
      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        console.log("[Student] Peer connection state:", state);
        
        if (state === "connected") {
          setConnectionStatus("🔗 Peer Connected");
        } else if (state === "connecting") {
          setConnectionStatus("🔄 Connecting...");
        } else if (state === "failed") {
          setConnectionStatus("❌ Connection Failed");
          setStatus("❌ Peer connection failed. Check your internet and try again.");
        } else if (state === "disconnected") {
          setConnectionStatus("⚠️ Disconnected");
        }
      };

      // Create offer
      setStatus("📝 Creating WebRTC offer...");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      
      setStatus("⏳ Gathering ICE candidates (may take a few seconds)...");
      await waitForIceGathering(peer, 8000);

      // Display offer in base64 for manual copy-paste
      const offerB64 = btoa(JSON.stringify(peer.localDescription));
      setOfferSDP(offerB64);
      setShowOfferStep(true);
      setShowAnswerStep(false);
      setStatus("✅ Offer created! Copy the offer and share with shop keeper.");

    } catch (err) {
      console.error("Failed to create offer:", err);
      setStatus("❌ Error: " + err.message);
      setConnectionStatus("Failed");
    }
  };

  // STEP 2.5: Copy offer to clipboard
  const copyOfferToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(offerSDP);
      setStatus("✅ Offer copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy:", err);
      setStatus("❌ Failed to copy. Please copy manually.");
    }
  };

  // STEP 2.75: Paste answer from shop
  const pasteAnswerFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setAnswerSDP(text);
      setStatus("✅ Answer pasted. Click 'Set Answer' to complete connection.");
    } catch (err) {
      console.error("Failed to paste:", err);
      setStatus("❌ Failed to paste from clipboard.");
    }
  };

  // STEP 2.9: Set remote answer
  const setRemoteAnswer = async () => {
    if (!answerSDP.trim()) {
      alert("Paste the answer SDP first");
      return;
    }

    try {
      setStatus("🔄 Setting remote answer...");
      const answerB64 = answerSDP.trim();
      const answer = JSON.parse(atob(answerB64));
      await peerRef.current.setRemoteDescription(answer);
      setStatus("✅ Answer set! Waiting for data channel to open (this may take 5-10 seconds)...");
      setShowAnswerStep(false);
      
      // Wait for data channel to actually open (up to 15 seconds)
      let timeout = 0;
      const maxTimeout = 15000;
      const checkInterval = 500;
      
      const waitForChannelOpen = setInterval(() => {
        timeout += checkInterval;
        const connStatus = getConnectionStatus(peerRef.current);
        const chStatus = dataChannelRef.current ? getDataChannelStatus(dataChannelRef.current) : { readyState: 'not created' };
        
        setDiagnostics(`ICE: ${connStatus.iceConnectionState} | Peer: ${connStatus.connectionState} | Channel: ${chStatus.readyState}`);
        
        if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
          clearInterval(waitForChannelOpen);
          setDataChannelStatus("✅ DataChannel OPEN");
          setConnectionStatus("✅ Connected");
          setIsConnected(true);
          setStatus("✅ Connected! Ready to send file.");
          setDiagnostics("");
        } else if (timeout >= maxTimeout) {
          clearInterval(waitForChannelOpen);
          setStatus("❌ Data channel did not open after 15 seconds. Check internet connection and try again.");
          const finalStatus = getConnectionStatus(peerRef.current);
          setDiagnostics(`Final state - ICE: ${finalStatus.iceConnectionState} | Peer: ${finalStatus.connectionState}`);
        }
      }, checkInterval);
      
    } catch (err) {
      console.error("Failed to set answer:", err);
      setStatus("❌ Error setting answer: " + err.message);
      const connStatus = getConnectionStatus(peerRef.current);
      setDiagnostics(JSON.stringify(connStatus, null, 2));
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
      alert("Data channel not open. Ensure connection is established.");
      return;
    }

    try {
      setIsSending(true);
      setStatus("🔒 Encrypting file...");
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

      const payloadStr = JSON.stringify(payload);
      console.log("[Student] About to send payload, size:", payloadStr.length);
      setStatus(`📤 Sending file (${Math.round(payloadStr.length / 1024)} KB in chunks)...`);
      sendData(payloadStr);
      console.log("[Student] Payload send initiated!");

      // Wait a bit for all chunks to be sent
      setTimeout(() => {
        setStatus("✅ File encrypted and sent! Share your 6-digit passcode with shop keeper.");
        setIsSending(false);
      }, 2000);
    } catch (err) {
      console.error("[Student] Error during send:", err);
      setStatus("❌ Error: " + err.message);
      setIsSending(false);
      alert("Error: " + err.message);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold mb-2">📱 Secure Upload</h2>
      <p className="text-slate-400 text-sm mb-6">Send encrypted files directly to the print shop</p>

      {/* FILE SELECTION */}
      <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 mb-4">
        <label className="block text-sm font-semibold mb-3">Select File to Print</label>
        <div className="relative">
          <input 
            type="file" 
            onChange={handleFileChange} 
            className="block w-full p-3 border border-slate-600 rounded-lg bg-slate-900 cursor-pointer hover:bg-slate-800 transition"
          />
        </div>
        {file && (
          <div className="mt-3 p-3 rounded-lg bg-slate-800/50">
            <span className="font-semibold text-emerald-400">✅ {file.name}</span>
            <div className="text-xs text-slate-400 mt-2">
              Size: {(file.size / 1024).toFixed(2)} KB<br/>
              Hash: <span className="font-mono text-emerald-300">{fileHash.substring(0, 16)}...</span>
            </div>
          </div>
        )}
      </div>

      {/* STEP 1: GENERATE PASSCODE */}
      <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg">Step 1: Generate Your Code</h3>
          {studentPasscode && (
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${
              timeRemaining > 60 ? 'bg-emerald-500/20 text-emerald-400' : 
              timeRemaining > 30 ? 'bg-amber-500/20 text-amber-400' : 
              timeRemaining > 0 ? 'bg-orange-500/20 text-orange-400' : 
              'bg-red-500/20 text-red-400'
            }`}>
              ⏱️ {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
            </span>
          )}
        </div>
        <button
          onClick={generateNewPasscode}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-500 transition"
        >
          🔐 Generate 6-Digit Code
        </button>

        {studentPasscode && (
          <div className="mt-4 p-4 rounded-lg bg-emerald-600/20 border-2 border-emerald-600">
            <p className="text-xs text-emerald-300 mb-3">📤 Share this code with shop keeper:</p>
            <p className="text-5xl font-mono font-bold text-emerald-400 text-center tracking-widest mb-3">
              {studentPasscode.code}
            </p>
            <p className="text-xs text-emerald-300 text-center">
              Call, SMS, WhatsApp, or tell them in-person
            </p>
          </div>
        )}
      </div>

      {/* STEP 2: SHARE CONNECTION DETAILS */}
      {studentPasscode && isPasscodeValid(studentPasscode) && (
        <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 mb-4">
          <h3 className="font-semibold text-lg mb-3">Step 2: Establish Connection</h3>
          <p className="text-xs text-slate-400 mb-4">Shop keeper provides their code after receiving yours</p>
          
          <div className="mb-4">
            <label className="text-sm text-slate-300 mb-2 block">Shop Keeper's 6-Digit Code:</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="000000"
                value={shopPasscode}
                onChange={(e) => setShopPasscode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength="6"
                className="w-32 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-3xl font-mono font-bold text-center text-emerald-400 focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={createOfferForShop}
                disabled={shopPasscode.length !== 6}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✓ Create Offer
              </button>
            </div>
          </div>

          {/* CONNECTION STATUS */}
          {(showOfferStep || isConnected) && (
            <div className={`mt-4 p-3 rounded-lg text-sm font-semibold ${
              isConnected 
                ? 'bg-emerald-600/20 border border-emerald-600 text-emerald-300' 
                : 'bg-blue-600/20 border border-blue-600 text-blue-300'
            }`}>
              {isConnected ? '✅ Connected!' : '🔄 ' + connectionStatus}
            </div>
          )}

          {/* OFFER DISPLAY */}
          {showOfferStep && offerSDP && (
            <div className="mt-4 p-4 rounded-lg bg-blue-600/20 border-2 border-blue-600">
              <p className="text-sm text-blue-300 mb-3 font-semibold">📤 Share this offer with shop keeper:</p>
              <textarea
                readOnly
                value={offerSDP}
                className="w-full h-24 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-xs font-mono text-slate-200 resize-none"
              />
              <button
                onClick={copyOfferToClipboard}
                className="mt-3 w-full bg-slate-700 text-slate-50 px-4 py-2 rounded-lg font-semibold hover:bg-slate-600 text-sm transition"
              >
                📋 Copy Offer to Clipboard
              </button>
            </div>
          )}

          {/* ANSWER PASTE */}
          {showOfferStep && (
            <div className="mt-4 p-4 rounded-lg bg-amber-600/20 border-2 border-amber-600">
              <p className="text-sm text-amber-300 mb-3 font-semibold">📥 Paste shop keeper's answer here:</p>
              <textarea
                value={answerSDP}
                onChange={(e) => setAnswerSDP(e.target.value)}
                placeholder="Paste the answer text here..."
                className="w-full h-24 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-xs font-mono text-slate-200 resize-none mb-3"
              />
              <div className="flex gap-2">
                <button
                  onClick={pasteAnswerFromClipboard}
                  className="flex-1 bg-slate-700 text-slate-50 px-4 py-2 rounded-lg font-semibold hover:bg-slate-600 text-sm transition"
                >
                  📋 Paste from Clipboard
                </button>
                <button
                  onClick={setRemoteAnswer}
                  disabled={!answerSDP.trim()}
                  className="flex-1 bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ✓ Set Answer
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: ENCRYPT & SEND */}
      {isConnected && (
        <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 mb-4">
          <h3 className="font-semibold text-lg mb-3">Step 3: Encrypt & Send File</h3>
          <button
            onClick={handleUpload}
            disabled={!file || isSending}
            className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-500 transition disabled:opacity-50 disabled:cursor-not-allowed text-lg"
          >
            {isSending ? "🔄 Sending..." : "🚀 Encrypt & Send"}
          </button>
          <p className="text-xs text-slate-400 mt-3">
            File will be encrypted with your passcode and securely sent
          </p>
        </div>
      )}

      {/* STATUS MESSAGES */}
      {status && (
        <div className="mt-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700">
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{status}</p>
        </div>
      )}

      {/* CONNECTION DEBUG INFO */}
      {(dataChannelStatus !== "No connection" || connectionStatus !== "Not connected") && (
        <div className="text-xs mt-4 p-3 border border-slate-700 rounded-lg bg-slate-900/40">
          <strong className="text-slate-300">🔌 Connection Status:</strong>
          <div className="mt-2 space-y-1 text-slate-400">
            <div>Data Channel: {dataChannelStatus}</div>
            <div>Peer Connection: {connectionStatus}</div>
          </div>
        </div>
      )}
      
      {diagnostics && (
        <div className="text-xs mt-4 p-3 border border-amber-700 rounded-lg bg-amber-900/20">
          <strong className="text-amber-300">🔍 Diagnostics:</strong>
          <div className="mt-2 text-amber-300 font-mono whitespace-pre-wrap break-words">{diagnostics}</div>
        </div>
      )}
    </div>
  );
}

export default UserUpload;