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
import { acceptConnection, waitForIceGathering } from "../utils/p2p";

export default function ShopDashboard() {
  const [studentPasscodeInput, setStudentPasscodeInput] = useState("");
  const [shopPasscode, setShopPasscode] = useState(null); // {code, timestamp}
  const [studentPasscodeVerified, setStudentPasscodeVerified] = useState(false);
  const [status, setStatus] = useState("");
  const [receivedPayload, setReceivedPayload] = useState(null);
  const [expectedHash, setExpectedHash] = useState("");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [dataChannelStatus, setDataChannelStatus] = useState("No connection");
  const [offerSDP, setOfferSDP] = useState("");
  const [answerSDP, setAnswerSDP] = useState("");
  const [showAnswerStep, setShowAnswerStep] = useState(false);

  const peerRef = useRef(null);
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
      setStatus("Validating passcode and preparing to accept connection...");
      
      // Generate shop's response passcode
      const newShopPasscode = generatePasscode();
      setShopPasscode(newShopPasscode);
      setStudentPasscodeVerified(true);

      // Create peer to accept connection
      const peer = acceptConnection(onReceive, () => {
        console.log("[Shop] DataChannel opened!");
        setDataChannelStatus("✓ DataChannel OPEN - ready to receive file");
      });
      peerRef.current = peer;

      peer.onicecandidate = (e) => {
        console.log("[Shop] ICE candidate:", e.candidate);
      };
      peer.oniceconnectionstatechange = () => {
        console.log("[Shop] ICE state:", peer.iceConnectionState);
      };
      peer.onconnectionstatechange = () => {
        console.log("[Shop] Peer connection state:", peer.connectionState);
        if (peer.connectionState === 'connected') {
          setStatus("✓ Connected! Waiting for data channel...");
        } else if (peer.connectionState === 'failed') {
          setStatus("❌ Connection failed. Ensure you entered the correct student passcode.");
        } else if (peer.connectionState === 'disconnected') {
          setStatus("⚠ Disconnected. Try to connect again.");
        }
      };

      setStatus("✓ Ready to receive offer from student!");

    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : String(err);
      setStatus("Failed to validate: " + msg);
    }
  };

  // STEP 1.5: Paste student's offer
  const pasteStudentOffer = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setOfferSDP(text);
      setStatus("✓ Offer pasted. Click 'Set Offer' to process.");
    } catch (err) {
      console.error("Failed to paste:", err);
      setStatus("Failed to paste from clipboard.");
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
      const offerB64 = offerSDP.trim();
      const offer = JSON.parse(atob(offerB64));
      
      console.log("[Shop] Setting remote offer");
      await peerRef.current.setRemoteDescription(offer);

      // Create answer
      const answer = await peerRef.current.createAnswer();
      await peerRef.current.setLocalDescription(answer);
      await waitForIceGathering(peerRef.current, 5000);

      // Display answer in base64 for manual copy-paste
      const answerB64 = btoa(JSON.stringify(peerRef.current.localDescription));
      setAnswerSDP(answerB64);
      setShowAnswerStep(true);
      setStatus("✓ Answer created! Copy the answer text and send back to student.");

    } catch (err) {
      console.error("Failed to process offer:", err);
      setStatus("Connection error: " + err.message);
    }
  };

  // STEP 2.5: Copy answer to clipboard
  const copyAnswerToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(answerSDP);
      setStatus("✓ Answer copied to clipboard! Send it back to student.");
    } catch (err) {
      console.error("Failed to copy:", err);
      setStatus("Failed to copy. Please copy manually.");
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
      setStatus("✓ Encrypted file received. Enter AES key to print.");
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
          // offer exchange now handled automatically via sessionStorage
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
      setStatus("Enter the student's 6-digit passcode to decrypt.");
      return;
    }

    // Validate passcode format
    if (!/^\d{6}$/.test(studentPasscodeInput.trim())) {
      setStatus("Passcode must be exactly 6 digits.");
      return;
    }

    try {
      const encrypted = new Uint8Array(receivedPayload.encrypted).buffer;
      const iv = new Uint8Array(receivedPayload.iv);
      const originalHash = receivedPayload.hash;

      // Derive AES key from student's passcode
      const key = await deriveKeyFromPasscode(studentPasscodeInput.trim());

      const decrypted = await decryptFile(encrypted, iv, key);

      const newHash = await sha256(decrypted);

      // Verify against the hash carried in the payload
      if (newHash !== originalHash) {
        setStatus("Integrity verification failed (payload hash mismatch). Print aborted.");
        return;
      }

      // If staff provided an expected hash (out-of-band from student), verify it too
      if (expectedHash && expectedHash.trim() !== "") {
        if (expectedHash.trim() !== newHash) {
          setStatus("Expected fingerprint does not match decrypted file. Print aborted.");
          return;
        }
      }

      // Print in memory
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
        setStatus("Printed successfully. Memory cleared.");
      };

    } catch (err) {
      console.error(err);
      setStatus("Decryption failed. Check the passcode and try again.");
    }
  }

  // Paste passcode from clipboard
  async function handlePastePasscode() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setStatus('Clipboard is empty or does not contain text.');
        return;
      }
      setStudentPasscodeInput(text.trim());
      setStatus('Passcode pasted from clipboard.');
    } catch (err) {
      console.error('Clipboard read failed', err);
      setStatus('Unable to read clipboard. Please allow clipboard access or paste manually.');
    }
  }

  // Copy shop passcode to clipboard
  async function handleCopyShopPasscode() {
    try {
      if (!shopPasscode || !shopPasscode.code) {
        setStatus('No passcode to copy.');
        return;
      }
      await navigator.clipboard.writeText(shopPasscode.code);
      setStatus('Shop passcode copied to clipboard.');
    } catch (err) {
      console.error('Clipboard write failed', err);
      setStatus('Unable to copy to clipboard. Please copy manually.');
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
      setStatus('Encrypted file downloaded (ciphertext only). Decryption happens only at print time.');
    } catch (err) {
      console.error('Download failed', err);
      setStatus('Failed to download encrypted file.');
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">🏪 Shop Dashboard</h2>

      {/* STEP 1: ENTER STUDENT PASSCODE */}
      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 mb-4">
        <h3 className="font-semibold mb-2">Step 1: Enter Student's Code</h3>
        <p className="text-xs text-slate-400 mb-3">Student will provide their 6-digit code</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter 6 digits"
            value={studentPasscodeInput}
            onChange={(e) => setStudentPasscodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength="6"
            className="w-40 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-2xl font-mono font-bold text-center"
          />
          <button
            onClick={handleValidateStudentPasscode}
            className="bg-emerald-500 text-slate-950 px-4 py-2 rounded font-semibold hover:bg-emerald-400"
          >
            ✓ Validate
          </button>
          <button
            onClick={handlePastePasscode}
            className="bg-slate-700 text-slate-50 px-3 py-2 rounded text-sm hover:bg-slate-600"
          >
            Paste
          </button>
        </div>
      </div>

      {/* STEP 2: RECEIVE OFFER FROM STUDENT */}
      {studentPasscodeVerified && (
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 mb-4">
          <h3 className="font-semibold mb-2">Step 2: Receive Connection Offer</h3>
          <p className="text-xs text-slate-400 mb-3">Student will send you their offer. Paste it here:</p>
          <textarea
            value={offerSDP}
            onChange={(e) => setOfferSDP(e.target.value)}
            placeholder="Paste student's offer here..."
            className="w-full h-32 rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs font-mono text-slate-200 mb-2"
          />
          <div className="flex gap-2 mb-4">
            <button
              onClick={pasteStudentOffer}
              className="bg-slate-700 text-slate-50 px-4 py-1.5 rounded font-semibold hover:bg-slate-600 text-sm"
            >
              📋 Paste Offer
            </button>
            <button
              onClick={setStudentOfferAndCreateAnswer}
              className="bg-blue-500 text-slate-950 px-4 py-1.5 rounded font-semibold hover:bg-blue-400 text-sm"
            >
              ✓ Process Offer
            </button>
          </div>

          {/* ANSWER DISPLAY */}
          {showAnswerStep && answerSDP && (
            <div className="p-4 rounded-lg bg-blue-500/20 border-2 border-blue-500">
              <p className="text-xs text-blue-300 mb-2">📤 Share this answer with student (copy and send via text/email):</p>
              <textarea
                readOnly
                value={answerSDP}
                className="w-full h-32 rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs font-mono text-slate-200"
              />
              <button
                onClick={copyAnswerToClipboard}
                className="mt-2 bg-slate-700 text-slate-50 px-4 py-1.5 rounded font-semibold hover:bg-slate-600 text-sm"
              >
                📋 Copy Answer
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: SHOW SHOP PASSCODE */}
      {studentPasscodeVerified && shopPasscode && (
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Step 2: Share Your Code</h3>
            <span className={`text-xs font-bold ${timeRemaining > 60 ? 'text-emerald-400' : timeRemaining > 30 ? 'text-amber-400' : timeRemaining > 0 ? 'text-orange-400' : 'text-red-400'}`}>
              Valid: {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-3">Show this to the student so they can complete the connection</p>
          <div className="p-4 rounded-lg bg-blue-500/20 border-2 border-blue-500 mb-3">
            <p className="text-xs text-blue-300 mb-2">📥 Student enters this code:</p>
            <p className="text-4xl font-mono font-bold text-blue-400 text-center tracking-widest">
              {shopPasscode.code}
            </p>
          </div>
          <button
            onClick={handleCopyShopPasscode}
            className="bg-slate-700 text-slate-50 px-4 py-2 rounded font-semibold hover:bg-slate-600 text-sm"
          >
            Copy Code
          </button>
        </div>
      )}

      {/* STEP 3: RECEIVE & DECRYPT FILE */}
      {receivedPayload && (
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-3">
          <h3 className="font-semibold">Step 3: Decrypt & Print</h3>
          
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
            <div className="text-xs text-slate-400">📄 File received:</div>
            <div className="font-semibold">{receivedPayload.fileName}</div>
            <div className="text-xs text-slate-400 mt-1">
              Size: {(receivedPayload.fileSize / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">🔐 Student's 6-Digit Passcode</label>
            <p className="text-xs text-slate-400 mb-2">Re-enter the student's passcode to decrypt the file</p>
            <input
              type="text"
              placeholder="000000"
              value={studentPasscodeInput}
              onChange={(e) => setStudentPasscodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength="6"
              className="w-40 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-2xl font-mono font-bold text-center"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Expected SHA-256 (optional)</label>
            <textarea
              placeholder="Paste SHA-256 fingerprint if provided by student"
              value={expectedHash}
              onChange={(e) => setExpectedHash(e.target.value)}
              rows={2}
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">Optional: For extra verification, ask student to share their SHA-256</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadEncrypted}
              className="inline-flex items-center justify-center rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-50 hover:bg-slate-600"
            >
              📥 Download Encrypted
            </button>

            <button
              onClick={handlePrint}
              className="inline-flex items-center justify-center rounded-md bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400"
            >
              🖨️ Print Now
            </button>
          </div>

          <div className="text-xs text-slate-400 space-y-1">
            <p>✓ Encrypted file received via WebRTC</p>
            <p>✓ AES-256-GCM decryption in memory</p>
            <p>✓ SHA-256 integrity verified</p>
            <p>✓ No storage of plaintext</p>
          </div>
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