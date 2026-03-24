import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = 'http://0mahzpiNuw:vO1oBqrL1Q@154.40.32.64:14727';

for (let i = 1; i <= 8; i++) {
  try {
    const agent = new HttpsProxyAgent(proxyUrl);
    const res = await fetch('https://api.ipify.org?format=json', { agent });
    const data = await res.json();
    console.log(`Test ${i}: ${data.ip}`);
  } catch (e) {
    console.log(`Test ${i}: ERROR - ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 1000));
}
