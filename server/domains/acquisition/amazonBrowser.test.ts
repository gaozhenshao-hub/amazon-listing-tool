import { describe,expect,it } from 'vitest';
import { isAmazonBrowserUrlAllowed } from './amazonBrowser';
describe('browser acquisition network boundary',()=>{
  it('only permits HTTPS Amazon product and asset origins',()=>{
    expect(isAmazonBrowserUrlAllowed('https://www.amazon.com/dp/B08C7LHM7S')).toBe(true);
    expect(isAmazonBrowserUrlAllowed('https://m.media-amazon.com/images/I/test.jpg')).toBe(true);
    for(const url of ['http://www.amazon.com/','https://127.0.0.1/','http://169.254.169.254/latest/meta-data/','https://www.amazon.com.evil.example/','https://user:secret@www.amazon.com/','https://www.amazon.com:3000/','file:///etc/passwd']) expect(isAmazonBrowserUrlAllowed(url)).toBe(false);
  });
});
