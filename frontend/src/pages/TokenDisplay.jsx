import React from "react";
import { QRCodeCanvas } from "qrcode.react";

export default function TokenDisplay({ offerSDP, aesKey, fileName, fileHash }) {
  if (!offerSDP || !aesKey) {
    return (
      <div className="max-w-xl mx-auto">
        <p className="text-sm text-red-400">No active secure session. Please upload a file first.</p>
      </div>
    );
  }

  const sharePayload = JSON.stringify({
    offer: offerSDP,
    keyB64: aesKey,
    fileName: fileName || null,
    fileHash: fileHash || null
  });

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-3">Share Secure Connection with Print Shop</h1>

      <p className="text-sm text-slate-300 mb-4">
        Give the shop this connection code, AES key, and file fingerprint. The file is encrypted client-side and transmitted directly via peer-to-peer connection.
      </p>

      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-4">

        {/* WebRTC Offer */}
        <div>
          <div className="text-slate-400 text-xs uppercase mb-1">Connection Code (Offer SDP)</div>
          <textarea value={offerSDP} readOnly rows={6} className="w-full text-[10px] font-mono bg-slate-950/70 border border-slate-800 rounded px-2 py-1" />
        </div>

        {/* AES Key */}
        <div>
          <div className="text-slate-400 text-xs uppercase mb-1">AES-256 Key (Base64)</div>
          <div className="font-mono text-[10px] break-all bg-slate-950/70 border border-slate-800 rounded px-2 py-1">{aesKey}</div>
        </div>

        {/* File Info */}
        {fileName && (
          <div>
            <div className="text-slate-400 text-xs uppercase mb-1">File</div>
            <div className="font-mono text-[10px] break-all bg-slate-950/70 border border-slate-800 rounded px-2 py-1">{fileName}</div>
          </div>
        )}

        {fileHash && (
          <div>
            <div className="text-slate-400 text-xs uppercase mb-1">SHA-256 Fingerprint (hex)</div>
            <div className="font-mono text-[10px] break-all bg-slate-950/70 border border-slate-800 rounded px-2 py-1">{fileHash}</div>
          </div>
        )}

        {/* QR Code */}
        <div className="flex flex-col items-center">
          <QRCodeCanvas value={sharePayload} size={160} bgColor="#020617" fgColor="#22c55e" />
          <div className="mt-2 text-xs text-slate-400 text-center">Shop can scan this QR to get connection + key + fingerprint</div>
        </div>

        {/* Security Notes */}
        <div className="text-xs text-slate-400 mt-2 space-y-1">
          <p>✓ AES-256-GCM encryption in browser</p>
          <p>✓ No server storage</p>
          <p>✓ Direct peer-to-peer transmission</p>
          <p>✓ Key never stored anywhere</p>
        </div>
      </div>
    </div>
  );
}