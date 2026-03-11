import React, { useState, useRef, useEffect } from "react";
import QrScanner from "qr-scanner";
import {
  generatePasscode,
  isPasscodeValid,
  getTimeRemaining,
  deriveKeyFromPasscode,
  decryptFile,
  sha256
} from "../utils/crypto";
import { acceptConnection, waitForIceGathering, getConnectionStatus, getDataChannelStatus } from "../utils/p2p";

export default function ShopDashboard() {
  const [studentPasscodeInput, setStudentPasscodeInput] = useState("");
  const [shopPasscode, setShopPasscode] = useState(null); // {code, timestamp}
  const [studentPasscodeVerified, setStudentPasscodeVerified] = useState(false);
  const [status, setStatus] = useState("");
  const [dataChannelStatus, setDataChannelStatus] = useState("No connection");
  const [connectionStatus, setConnectionStatus] = useState("Not connected");
  const [receivedPayload, setReceivedPayload] = useState(null);
  const [expectedHash, setExpectedHash] = useState("");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [offerSDP, setOfferSDP] = useState("");
  const [answerSDP, setAnswerSDP] = useState("");
  const [showAnswerStep, setShowAnswerStep] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [diagnostics, setDiagnostics] = useState("");

  const peerRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileInputRef = useRef(null);
  const [qrError, setQrError] = useState("");
  const messageBufferRef = useRef(""); // Buffer for reassembling chunked messages

  // Countdown timer for passcodes
  useEffect(() => {
    if (!studentPasscodeVerified && !shopPasscode) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      let remaining = 0;
      if (shopPasscode) {
        remaining = getTimeRemaining(shopPasscode);
        setTimeRemaining(remaining);
        if (remaining === 0) {
          setShopPasscode(null);
          setStatus("⏰ Shop passcode expired. Generate a new one to reconnect.");
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [shopPasscode, studentPasscodeVerified]);

  // STEP 1: Validate Student's Passcode and create peer
  const handleValidateStudentPasscode = async () => {
    if (!studentPasscodeInput.trim() || !/^\d{6}$/.test(studentPasscodeInput.trim())) {
      alert("Enter student's 6-digit passcode");
      return;
    }

    try {
      setStatus("🔄 Validating passcode and preparing to accept connection...");
      setConnectionStatus("Initializing...");
      
      // Generate shop's response passcode
      const newShopPasscode = generatePasscode();
      setShopPasscode(newShopPasscode);
      setStudentPasscodeVerified(true);

      // Create peer to accept connection
      const peer = acceptConnection(onReceive, () => {
        console.log("[Shop] DataChannel opened!");
        setDataChannelStatus("✅ DataChannel OPEN");
        setConnectionStatus("✅ Connected");
        setStatus("✅ Connected! Waiting for encrypted file...");
      }, undefined, (ch) => {
        console.log("[Shop] Data channel created");
        dataChannelRef.current = ch;
      });
      peerRef.current = peer;

      peer.onicecandidate = (e) => {
        console.log("[Shop] ICE candidate:", e.candidate?.candidate || "gathering...");
      };
      
      peer.oniceconnectionstatechange = () => {
        const state = peer.iceConnectionState;
        console.log("[Shop] ICE state:", state);
        
        if (state === "connected" || state === "completed") {
          setConnectionStatus("🔗 ICE Connected - Waiting for data channel...");
        } else if (state === "checking") {
          setConnectionStatus("🔍 Checking connection...");
        } else if (state === "failed") {
          setConnectionStatus("❌ ICE Connection Failed");
          setStatus("❌ Connection failed. Verify student passcode and try again.");
        } else if (state === "disconnected") {
          setConnectionStatus("⚠️ ICE Disconnected");
        }
      };
      
      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        console.log("[Shop] Peer connection state:", state);
        
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

      setStatus("✅ Ready to receive offer from student!");

    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : String(err);
      setStatus("❌ Failed to validate: " + msg);
      setConnectionStatus("Failed");
    }
  };

  // STEP 1.5: Paste student's offer
  const pasteStudentOffer = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setOfferSDP(text);
      setStatus("✅ Offer pasted. Click 'Set Offer' to process.");
    } catch (err) {
      console.error("Failed to paste:", err);
      setStatus("❌ Failed to paste from clipboard.");
    }
  };

  // STEP 2: Set student's offer and create answer
  const setStudentOfferAndCreateAnswer = async () => {
    if (!offerSDP.trim()) {
      alert("Paste the student's offer first");
      return;
    }

    if (!peerRef.current) {
      alert("Validate student's passcode first");
      return;
    }

    try {
      setStatus("🔄 Processing offer...");
      const offerB64 = offerSDP.trim();
      const offer = JSON.parse(atob(offerB64));
      
      console.log("[Shop] Setting remote offer");
      await peerRef.current.setRemoteDescription(offer);

      // Create answer
      setStatus("📝 Creating answer...");
      const answer = await peerRef.current.createAnswer();
      await peerRef.current.setLocalDescription(answer);
      
      setStatus("⏳ Gathering ICE candidates...");
      await waitForIceGathering(peerRef.current, 10000);

      // Display answer in base64 for manual copy-paste
      const answerB64 = btoa(JSON.stringify(peerRef.current.localDescription));
      setAnswerSDP(answerB64);
      setShowAnswerStep(true);
      setStatus("✅ Answer created! Copy and send back to student.");
      
      // Start monitoring for data channel (shop receives the data channel from student)
      let timeout = 0;
      const maxTimeout = 20000;
      const checkInterval = 500;
      
      const monitorChannel = setInterval(() => {
        timeout += checkInterval;
        const connStatus = getConnectionStatus(peerRef.current);
        const chStatus = dataChannelRef.current ? getDataChannelStatus(dataChannelRef.current) : { readyState: 'waiting for student channel' };
        
        setDiagnostics(`ICE: ${connStatus.iceConnectionState} | Peer: ${connStatus.connectionState} | Channel: ${chStatus.readyState}`);
        
        if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
          clearInterval(monitorChannel);
          setDataChannelStatus("✅ DataChannel OPEN");
          setConnectionStatus("✅ Connected");
          setStatus("✅ Connected! Waiting for encrypted file...");
          setDiagnostics("");
        } else if (timeout >= maxTimeout) {
          clearInterval(monitorChannel);
          // Don't show timeout error on shop side, just update diagnostics
          const finalStatus = getConnectionStatus(peerRef.current);
          setDiagnostics(`Final state - ICE: ${finalStatus.iceConnectionState} | Peer: ${finalStatus.connectionState}`);
        }
      }, checkInterval);

    } catch (err) {
      console.error("Failed to process offer:", err);
      setStatus("❌ Connection error: " + err.message);
      setConnectionStatus("Failed");
      const connStatus = getConnectionStatus(peerRef.current);
      setDiagnostics(JSON.stringify(connStatus, null, 2));
    }
  };

  // STEP 2.5: Copy answer to clipboard
  const copyAnswerToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(answerSDP);
      setStatus("✅ Answer copied to clipboard! Send it back to student.");
    } catch (err) {
      console.error("Failed to copy:", err);
      setStatus("❌ Failed to copy. Please copy manually.");
    }
  };

  // Receive Encrypted File
  function onReceive(data) {
    console.log('[Shop] onReceive called, data type:', typeof data);
    
    // Accumulate incoming chunks
    if (typeof data === 'string') {
      messageBufferRef.current += data;
    } else {
      messageBufferRef.current = data;
    }
    
    // Try to parse the accumulated buffer
    try {
      const parsed = typeof messageBufferRef.current === 'string' 
        ? JSON.parse(messageBufferRef.current) 
        : messageBufferRef.current;
      console.log('[Shop] Parsed successfully:', parsed);
      setReceivedPayload(parsed);
      setStatus("✅ Encrypted file received! Enter student passcode to decrypt and print.");
      messageBufferRef.current = ""; // Clear buffer after successful parse
    } catch (err) {
      // Not a complete JSON yet, wait for more chunks
      console.log('[Shop] Incomplete JSON, waiting for more chunks. Buffer size:', messageBufferRef.current.length);
    }
  }

  // QR helper: parse scanned QR payload (JSON) and populate fields
  function handleQrFile(e) {
    setQrError("");
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    QrScanner.scanImage(file, { returnDetailedScanResult: false })
      .then((result) => {
        try {
          const payload = JSON.parse(result.data || result);
          if (payload.fileHash) setExpectedHash(payload.fileHash);
          setQrError("");
        } catch (err) {
          console.error("Failed to parse QR payload:", err);
          setQrError("QR content is not valid JSON or missing expected fields.");
        }
      })
      .catch((err) => {
        console.error("QR scan failed:", err);
        setQrError("Failed to scan QR image.");
      });
  }

  // STEP 3: Decrypt + Verify + Print
  async function handlePrint() {
    if (!receivedPayload) return;
    if (!studentPasscodeInput.trim()) {
      setStatus("❌ Enter the student's 6-digit passcode to decrypt.");
      return;
    }

    // Validate passcode format
    if (!/^\d{6}$/.test(studentPasscodeInput.trim())) {
      setStatus("❌ Passcode must be exactly 6 digits.");
      return;
    }

    try {
      setIsDecrypting(true);
      setStatus("🔓 Decrypting file...");
      const encrypted = new Uint8Array(receivedPayload.encrypted).buffer;
      const iv = new Uint8Array(receivedPayload.iv);
      const originalHash = receivedPayload.hash;

      // Derive AES key from student's passcode
      const key = await deriveKeyFromPasscode(studentPasscodeInput.trim());

      const decrypted = await decryptFile(encrypted, iv, key);

      setStatus("✔️ Verifying file integrity...");
      const newHash = await sha256(decrypted);

      // Verify against the hash carried in the payload
      if (newHash !== originalHash) {
        setStatus("❌ Integrity verification failed. Print aborted.");
        setIsDecrypting(false);
        return;
      }

      // If staff provided an expected hash (out-of-band from student), verify it too
      if (expectedHash && expectedHash.trim() !== "") {
        if (expectedHash.trim() !== newHash) {
          setStatus("❌ Expected fingerprint doesn't match. Print aborted.");
          setIsDecrypting(false);
          return;
        }
      }

      // Print in memory
      setStatus("🞨 Opening print dialog...");
      const blob = new Blob([decrypted]);
      const url = URL.createObjectURL(blob);

      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        iframe.contentWindow.print();
        URL.revokeObjectURL(url);

        // Clear memory
        setReceivedPayload(null);
        setStudentPasscodeInput("");
        setStatus("✅ Printed successfully. Memory cleared.");
        setIsDecrypting(false);
      };

    } catch (err) {
      console.error(err);
      setStatus("❌ Decryption failed. Check the passcode and try again.");
      setIsDecrypting(false);
    }
  }

  // Paste passcode from clipboard
  async function handlePastePasscode() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setStatus('❌ Clipboard is empty.');
        return;
      }
      setStudentPasscodeInput(text.trim().substring(0, 6));
      setStatus('✅ Passcode pasted from clipboard.');
    } catch (err) {
      console.error('Clipboard read failed', err);
      setStatus('❌ Unable to read clipboard. Please allow clipboard access or paste manually.');
    }
  }

  // Copy shop passcode to clipboard
  async function handleCopyShopPasscode() {
    try {
      if (!shopPasscode || !shopPasscode.code) {
        setStatus('❌ No passcode to copy.');
        return;
      }
      await navigator.clipboard.writeText(shopPasscode.code);
      setStatus('✅ Shop passcode copied to clipboard.');
    } catch (err) {
      console.error('Clipboard write failed', err);
      setStatus('❌ Unable to copy to clipboard. Please copy manually.');
    }
  }

  // Download the ciphertext as a .enc file (ciphertext only)
  function handleDownloadEncrypted() {
    if (!receivedPayload) return;
    try {
      const arr = new Uint8Array(receivedPayload.encrypted);
      const blob = new Blob([arr], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      const name = receivedPayload.fileName ? `${receivedPayload.fileName}.enc` : 'file.enc';
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      }, 500);
      setStatus('✅ Encrypted file downloaded (ciphertext only). Decryption happens only at print time.');
    } catch (err) {
      console.error('Download failed', err);
      setStatus('❌ Failed to download encrypted file.');
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold mb-2">🏪 Shop Dashboard</h2>
      <p className="text-slate-400 text-sm mb-6">Receive and decrypt encrypted files securely</p>

      {/* STEP 1: ENTER STUDENT PASSCODE */}
      <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 mb-4">
        <h3 className="font-semibold text-lg mb-3">Step 1: Validate Student Code</h3>
        <p className="text-xs text-slate-400 mb-3">Student provides their 6-digit code</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="000000"
            value={studentPasscodeInput}
            onChange={(e) => setStudentPasscodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength="6"
            className="w-32 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-3xl font-mono font-bold text-center text-emerald-400 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleValidateStudentPasscode}
            disabled={studentPasscodeInput.length !== 6}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✓ Validate
          </button>
          <button
            onClick={handlePastePasscode}
            className="bg-slate-700 text-slate-50 px-3 py-2 rounded-lg font-semibold hover:bg-slate-600 transition text-sm"
          >
            📋 Paste
          </button>
        </div>
      </div>

      {/* CONNECTION STATUS */}
      {studentPasscodeVerified && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-semibold ${
          dataChannelStatus === "✅ DataChannel OPEN"
            ? 'bg-emerald-600/20 border border-emerald-600 text-emerald-300' 
            : 'bg-blue-600/20 border border-blue-600 text-blue-300'
        }`}>
          {dataChannelStatus === "✅ DataChannel OPEN" ? '✅ Connected!' : '🔄 ' + connectionStatus}
        </div>
      )}

      {/* STEP 2: RECEIVE OFFER FROM STUDENT */}
      {studentPasscodeVerified && (
        <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 mb-4">
          <h3 className="font-semibold text-lg mb-3">Step 2: Establish Connection</h3>
          <p className="text-xs text-slate-400 mb-3">Student sends their offer - paste it here:</p>
          <textarea
            value={offerSDP}
            onChange={(e) => setOfferSDP(e.target.value)}
            placeholder="Paste student's offer here..."
            className="w-full h-24 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-xs font-mono text-slate-200 resize-none mb-3"
          />
          <div className="flex gap-2 mb-4">
            <button
              onClick={pasteStudentOffer}
              className="flex-1 bg-slate-700 text-slate-50 px-4 py-2 rounded-lg font-semibold hover:bg-slate-600 text-sm transition"
            >
              📋 Paste Offer
            </button>
            <button
              onClick={setStudentOfferAndCreateAnswer}
              disabled={!offerSDP.trim()}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ✓ Process Offer
            </button>
          </div>

          {/* ANSWER DISPLAY */}
          {showAnswerStep && answerSDP && (
            <div className="p-4 rounded-lg bg-blue-600/20 border-2 border-blue-600 mb-4">
              <p className="text-sm text-blue-300 mb-3 font-semibold">📤 Share this answer with student:</p>
              <textarea
                readOnly
                value={answerSDP}
                className="w-full h-24 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-xs font-mono text-slate-200 resize-none"
              />
              <button
                onClick={copyAnswerToClipboard}
                className="mt-3 w-full bg-slate-700 text-slate-50 px-4 py-2 rounded-lg font-semibold hover:bg-slate-600 text-sm transition"
              >
                📋 Copy Answer to Clipboard
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2B: SHOW SHOP PASSCODE */}
      {studentPasscodeVerified && shopPasscode && (
        <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-lg">Your Code (for Student)</h3>
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${
              timeRemaining > 60 ? 'bg-emerald-500/20 text-emerald-400' : 
              timeRemaining > 30 ? 'bg-amber-500/20 text-amber-400' : 
              timeRemaining > 0 ? 'bg-orange-500/20 text-orange-400' : 
              'bg-red-500/20 text-red-400'
            }`}>
              ⏱️ {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-3">Show this to the student so they can complete the connection</p>
          <div className="p-4 rounded-lg bg-blue-600/20 border-2 border-blue-600 mb-3">
            <p className="text-xs text-blue-300 mb-2">📥 Student enters this code:</p>
            <p className="text-5xl font-mono font-bold text-blue-400 text-center tracking-widest">
              {shopPasscode.code}
            </p>
          </div>
          <button
            onClick={handleCopyShopPasscode}
            className="w-full bg-slate-700 text-slate-50 px-4 py-2 rounded-lg font-semibold hover:bg-slate-600 transition"
          >
            📋 Copy Code to Clipboard
          </button>
        </div>
      )}

      {/* STEP 3: RECEIVE & DECRYPT FILE */}
      {receivedPayload && (
        <div className="border border-slate-700 rounded-xl p-4 bg-slate-900/40 space-y-3 mb-4">
          <h3 className="font-semibold text-lg">Step 3: Decrypt & Print</h3>
          
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-600">
            <div className="text-xs text-slate-400 mb-1">📄 File Received:</div>
            <div className="font-semibold text-emerald-400">{receivedPayload.fileName}</div>
            <div className="text-xs text-slate-400 mt-2">
              Size: {(receivedPayload.fileSize / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">🔐 Student's 6-Digit Passcode</label>
            <p className="text-xs text-slate-400 mb-3">Enter the student's passcode to decrypt the file</p>
            <input
              type="text"
              placeholder="000000"
              value={studentPasscodeInput}
              onChange={(e) => setStudentPasscodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength="6"
              className="w-40 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-3xl font-mono font-bold text-center text-emerald-400"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Expected SHA-256 (Optional)</label>
            <textarea
              placeholder="Paste SHA-256 fingerprint from student for extra verification..."
              value={expectedHash}
              onChange={(e) => setExpectedHash(e.target.value)}
              rows={2}
              className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-xs font-mono text-slate-200 resize-none"
            />
            <p className="text-xs text-slate-400 mt-2">🔒 Optional: Ask student to share SHA-256 for integrity verification</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDownloadEncrypted}
              className="flex-1 bg-slate-700 text-slate-50 px-4 py-2 rounded-lg font-semibold hover:bg-slate-600 transition text-sm"
            >
              📥 Save Encrypted
            </button>

            <button
              onClick={handlePrint}
              disabled={!studentPasscodeInput || studentPasscodeInput.length !== 6 || isDecrypting}
              className="flex-1 bg-sky-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-sky-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDecrypting ? "🔄 Decrypting..." : "🖨️ Print Now"}
            </button>
          </div>

          <div className="text-xs text-slate-400 space-y-1 pt-2 border-t border-slate-700">
            <p>✅ File received via secure WebRTC</p>
            <p>✅ AES-256-GCM decryption in memory</p>
            <p>✅ SHA-256 integrity verification</p>
            <p>✅ No file stored on device</p>
          </div>
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

      {qrError && (
        <div className="mt-4 p-3 rounded-md bg-red-500/20 border border-red-600 text-red-300 text-xs">
          {qrError}
        </div>
      )}
    </div>
  );
}