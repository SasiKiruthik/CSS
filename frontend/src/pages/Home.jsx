import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold mb-4">Secure PrintHub</h1>

      <p className="text-slate-300 mb-6">
        Privacy-preserving peer-to-peer printing system. Documents are encrypted
        locally in your browser using AES-256-GCM and transmitted directly to
        the print shop via secure WebRTC connection. No server storage. No cloud.
        No plaintext exposure.
      </p>

      <div className="grid gap-4 md:grid-cols-2">

        {/* STUDENT SIDE */}
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
          <h2 className="font-medium mb-2">For Students</h2>

          <ul className="text-sm text-slate-300 list-disc list-inside space-y-1 mb-3">
            <li>6-digit passcode for simple key derivation</li>
            <li>AES-256-GCM encryption derived from passcode</li>
            <li>SHA-256 fingerprint verification</li>
            <li>Direct browser-to-browser transfer via WebRTC</li>
            <li>No server storage</li>
          </ul>

          <Link
            to="/user/upload"
            className="inline-flex items-center justify-center rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Start Secure Upload
          </Link>
        </div>

        {/* SHOP SIDE */}
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
          <h2 className="font-medium mb-2">For Print Shops</h2>

          <ul className="text-sm text-slate-300 list-disc list-inside space-y-1 mb-3">
            <li>Receive encrypted file via WebRTC</li>
            <li>Enter 6-digit passcode to derive AES key</li>
            <li>Decrypt only in memory</li>
            <li>SHA-256 verification before printing</li>
            <li>No preview, no saving, no storage</li>
          </ul>

          <Link
            to="/shop/dashboard"
            className="inline-flex items-center justify-center rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-50 hover:bg-slate-700"
          >
            Open Shop Dashboard
          </Link>
        </div>

      </div>

      {/* SECURITY SUMMARY */}
      <div className="mt-8 text-xs text-slate-400 space-y-1 border-t border-slate-800 pt-4">
        <p>✓ 6-digit passcode for key derivation (PBKDF2-SHA256)</p>
        <p>✓ AES-256-GCM client-side encryption</p>
        <p>✓ SHA-256 integrity verification</p>
        <p>✓ Zero backend storage</p>
        <p>✓ Zero-trust printing model</p>
        <p>✓ Automatic in-memory cleanup after print</p>
      </div>
    </div>
  );
}