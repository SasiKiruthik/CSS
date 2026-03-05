// Hardened WebCrypto helper for AES-256-GCM + SHA-256

// ==============================
// PASSCODE UTILITIES (TIME-LIMITED)
// ==============================
export function generatePasscode() {
  // Generate a 6-digit passcode (000000 - 999999) with timestamp
  const code = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  const timestamp = Date.now();
  return {
    code,
    timestamp,
    display: code // For UI display
  };
}

export function isPasscodeValid(passcodeObj, maxAgeMs = 150000) {
  // Check if passcode is still within validity window (default 150 seconds = 2:30 minutes)
  if (!passcodeObj || !passcodeObj.timestamp) {
    return false;
  }
  const age = Date.now() - passcodeObj.timestamp;
  return age <= maxAgeMs;
}

export function getTimeRemaining(passcodeObj, maxAgeMs = 150000) {
  // Get remaining time in seconds (default 150 seconds = 2:30 minutes)
  if (!passcodeObj || !passcodeObj.timestamp) {
    return 0;
  }
  const age = Date.now() - passcodeObj.timestamp;
  const remaining = Math.max(0, Math.ceil((maxAgeMs - age) / 1000));
  return remaining;
}

// ==============================
// KEY GENERATION FROM PASSCODE
// ==============================
export async function deriveKeyFromPasscode(passcode) {
  // Convert passcode to bytes
  const encoder = new TextEncoder();
  const passcodeBytes = encoder.encode(passcode);
  
  // Import passcode as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passcodeBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  
  // Derive 256-bit key using PBKDF2 (simple salt for consistency)
  const salt = encoder.encode("SecurePrintHub2025");
  
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt,
      iterations: 100000 // NIST recommendation for password-based KDF
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // not extractable for security
    ["encrypt", "decrypt"]
  );
  
  return derivedKey;
}

// ==============================
// LEGACY: RANDOM KEY GENERATION (KEPT FOR BACKWARDS COMPATIBILITY)
// ==============================
export async function generateAESKey() {
  return await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true, // must be true so user can share key
    ["encrypt", "decrypt"]
  );
}

// ==============================
// SAFE BASE64 CONVERSION
// ==============================
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function exportKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}

export async function importKey(base64) {
  const raw = base64ToUint8Array(base64);
  return await crypto.subtle.importKey(
    "raw",
    raw,
    {
      name: "AES-GCM"
    },
    false, // not extractable after import
    ["decrypt"]
  );
}

// ==============================
// ENCRYPTION
// ==============================
export async function encryptFile(buffer, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128
    },
    key,
    buffer
  );

  return { encrypted, iv };
}

// ==============================
// DECRYPTION
// ==============================
export async function decryptFile(encrypted, iv, key) {
  try {
    return await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128
      },
      key,
      encrypted
    );
  } catch (err) {
    throw new Error("Decryption failed (invalid key or tampered data)");
  }
}

// ==============================
// SHA-256
// ==============================
export async function sha256(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(hash);

  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ==============================
// MEMORY WIPE UTILITY
// ==============================
export function wipeUint8Array(arr) {
  if (arr && arr.fill) {
    arr.fill(0);
  }
}