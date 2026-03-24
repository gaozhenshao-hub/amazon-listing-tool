import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = 'http://0mahzpiNuw:vO1oBqrL1Q@154.40.32.64:14727';
const agent = new HttpsProxyAgent(proxyUrl);
console.log('Agent created, proxy:', proxyUrl);

try {
  const res = await fetch('https://httpbin.org/ip', { agent });
  const data = await res.json();
  console.log('httpbin result:', JSON.stringify(data));
} catch (e) {
  console.error('Error:', e.message);
}

try {
  const res2 = await fetch('https://api.ipify.org?format=json', { agent });
  const data2 = await res2.json();
  console.log('ipify result:', JSON.stringify(data2));
} catch (e) {
  console.error('Error2:', e.message);
}
