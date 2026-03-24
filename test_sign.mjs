import { createHash, createCipheriv } from "crypto";

// Replicate the generateSign function
function generateSign(appId, accessToken, timestamp, bodyParams = {}) {
  // Step 1: Flatten business params
  const allParams = {};
  for (const [key, value] of Object.entries(bodyParams)) {
    if (value === undefined || value === '') continue;
    if (typeof value === 'object' && value !== null) {
      allParams[key] = JSON.stringify(value);
    } else {
      allParams[key] = String(value);
    }
  }

  // Step 2: Add fixed params & remove sign/api_code
  allParams['access_token'] = accessToken;
  allParams['app_key'] = appId;
  allParams['timestamp'] = String(timestamp);
  delete allParams['sign'];
  delete allParams['api_code'];

  // Step 3: Sort by key ASCII
  const sortedKeys = Object.keys(allParams).sort();

  // Step 4: Concatenate key=value pairs (trim values)
  const parts = [];
  for (const k of sortedKeys) {
    const v = allParams[k];
    if (v !== '' && v !== undefined) {
      parts.push(`${k}=${String(v).trim()}`);
    }
  }
  const paramStr = parts.join('&');

  // Step 5: MD5 uppercase
  const md5Hash = createHash('md5').update(paramStr, 'utf8').digest('hex').toUpperCase();

  // Step 6: AES/ECB/PKCS5Padding with AppId as key
  const keyBuffer = padAesKey(appId);
  const cipher = createCipheriv('aes-128-ecb', keyBuffer, null);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(md5Hash, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return { paramStr, md5Hash, encrypted, encodedSign: encodeURIComponent(encrypted) };
}

function padAesKey(key) {
  const buf = Buffer.alloc(16, 0);
  const keyBuf = Buffer.from(key, 'utf8');
  keyBuf.copy(buf, 0, 0, Math.min(keyBuf.length, 16));
  return buf;
}

// Test with the official example data
const appId = "testAppId123";
const accessToken = "32573a1b-xxxx-xxxx-xxxx-a85fc12de26a";
const timestamp = 1680593889;
const bodyParams = {
  start_date: "2023-03-01 00:00:00",
  end_date: "2023-03-28 10:44:55",
  date_type: 2
};

const result = generateSign(appId, accessToken, timestamp, bodyParams);
console.log("=== Sign Generation Test ===");
console.log("Param String:", result.paramStr);
console.log("MD5 Hash:", result.md5Hash);
console.log("AES Encrypted (Base64):", result.encrypted);
console.log("URL Encoded:", result.encodedSign);

// Test with no body params (like seller/lists)
const result2 = generateSign(appId, accessToken, timestamp, {});
console.log("\n=== No Body Params Test ===");
console.log("Param String:", result2.paramStr);
console.log("MD5 Hash:", result2.md5Hash);
console.log("AES Encrypted (Base64):", result2.encrypted);
