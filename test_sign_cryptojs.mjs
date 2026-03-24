import CryptoJS from 'crypto-js';
import { createHash } from 'crypto';

const appId = 'testAppId123';
const accessToken = '32573a1b-xxxx-xxxx-xxxx-a85fc12de26a';
const timestamp = 1680593889;
const bodyParams = {
  start_date: "2023-03-01 00:00:00",
  end_date: "2023-03-28 10:44:55",
  date_type: 2
};

// Build param string (same logic)
const allParams = {};
for (const [key, value] of Object.entries(bodyParams)) {
  if (value === undefined || value === '') continue;
  if (typeof value === 'object' && value !== null) {
    allParams[key] = JSON.stringify(value);
  } else {
    allParams[key] = String(value);
  }
}
allParams['access_token'] = accessToken;
allParams['app_key'] = appId;
allParams['timestamp'] = String(timestamp);

const sortedKeys = Object.keys(allParams).sort();
const parts = [];
for (const k of sortedKeys) {
  const v = allParams[k];
  if (v !== '' && v !== undefined) {
    parts.push(`${k}=${String(v).trim()}`);
  }
}
const paramStr = parts.join('&');

// MD5 using Node.js crypto (faster)
const md5Hash = createHash('md5').update(paramStr, 'utf8').digest('hex').toUpperCase();

// AES using crypto-js (matches browser CryptoJS behavior)
const key = CryptoJS.enc.Utf8.parse(appId);
const encrypted = CryptoJS.AES.encrypt(md5Hash, key, {
  mode: CryptoJS.mode.ECB,
  padding: CryptoJS.pad.Pkcs7
});
const signValue = encrypted.toString();

console.log('Param String:', paramStr);
console.log('MD5 Hash:', md5Hash);
console.log('AES Sign:', signValue);
console.log('Expected:', 'KzFqrZ+mU4ZbhRrFCqoTcMzWZcZxD0icnAgd/aa/c8rfX+Br+gNdhQfcrARMvBo1');
console.log('Match:', signValue === 'KzFqrZ+mU4ZbhRrFCqoTcMzWZcZxD0icnAgd/aa/c8rfX+Br+gNdhQfcrARMvBo1');
