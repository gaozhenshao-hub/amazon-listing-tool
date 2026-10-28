import { describe, expect, it } from "vitest";
import { parseAmazonImageLayout, amazonImageUrl } from "./amazonImageLayout";
import { parseBasicAmazonImages } from "./basicAmazonProvider";
import { normalizeAmazonArtifact } from "./amazonNormalizer";
const img=(name:string)=>`<img src="https://m.media-amazon.com/images/I/${name}.jpg" alt="${name}">`;

describe("native Amazon image layout",()=>{
  it.each([3,4])("groups Premium A+ %s-column images with their individual headings and text",count=>{
    const result=parseAmazonImageLayout(`<div id="aplus"><div class="aplus-module premium-module-3-${count===3?'three':'four'}-column-images"><div class="premium-aplus-${count===3?'three':'four'}-column">${Array.from({length:count},(_,i)=>`<div class="premium-aplus-column"><div class="column-image">${img(String(i))}</div><div class="column-heading"><h1>Heading ${i}</h1></div><div class="column-description"><p>Body ${i}</p></div></div>`).join('')}</div></div></div>`);
    expect(result.layout.modules).toHaveLength(1);
    expect(result.layout.modules[0]).toMatchObject({kind:'grid',subtype:count===3?'三图文':'四图文',title:''});
    expect(result.layout.modules[0].cards.map(c=>[c.images.length,c.title,c.text])).toEqual(Array.from({length:count},(_,i)=>[1,`Heading ${i}`,`Body ${i}`]));
  });
  it("keeps nested standard three-column wrappers as three cards",()=>{
    const result=parseAmazonImageLayout(`<div id="aplus"><div class="aplus-module">${['a','b','c'].map(n=>`<div class="apm-thirdcol"><div class="apm-leftimage">${img(n)}</div><h3>${n}</h3><p>${n} body</p></div>`).join('')}</div></div>`);
    expect(result.layout.modules[0]).toMatchObject({kind:'grid',subtype:'三图文'});
    expect(result.layout.modules[0].cards.map(c=>c.title)).toEqual(['a','b','c']);
  });
  it("preserves seamless modules, carousel order and comparison columns",()=>{
    const html=`<div id="aplus_feature_div"><div class="aplus-module">${img('wide')}</div>
      <div class="aplus-module"><div class="a-carousel-card">${img('first')}</div><div class="a-carousel-card">${img('second')}</div></div>
      <div class="aplus-module comparison"><h2>Compare</h2><table><tr><th></th><td>${img('small1')}</td><td>${img('small2')}</td></tr><tr><th>Size</th><td>10</td><td>20</td></tr></table></div></div>`;
    const result=parseAmazonImageLayout(html);
    expect(result.layout.modules.map(m=>m.kind)).toEqual(['image','carousel','comparison']);
    expect(result.layout.modules[1].cards.map(c=>c.images[0].alt)).toEqual(['first','second']);
    expect(result.layout.modules[2].rows).toEqual([{label:'Size',cells:['10','20']}]);
    expect(result.urls.aplus).toHaveLength(5);
  });
  it("does not include inline CSS in comparison values",()=>{
    const result=parseAmazonImageLayout(`<div id="aplus"><div class="aplus-module comparison"><table><tr><th></th><td>${img('x')}</td></tr><tr><th>Reviews</th><td><style>.aplus-v2 { padding: 0; }</style>4.5 stars</td></tr></table></div></div>`);
    expect(result.layout.modules[0].rows[0].cells).toEqual(['4.5 stars']);
  });
  it("keeps four-image brand-story cards and their background separate from A+",()=>{
    const result=parseAmazonImageLayout(`<div id="aplus"><div id="aplusBrandStory_feature_div"><div class="apm-brand-story-background">${img('background')}</div><div class="a-carousel-card">${['a','b','c','d'].map(img).join('')}<h3>One card</h3></div><div class="a-carousel-card">${img('card2')}</div></div></div>`);
    expect(result.urls.aplus).toEqual([]);
    expect(result.layout.modules).toHaveLength(1);
    expect(result.layout.modules[0]).toMatchObject({kind:'brand_story',background:{alt:'background'}});
    expect(result.layout.modules[0].cards.map(c=>c.images.length)).toEqual([4,1]);
  });
  it("does not turn untrusted URLs or hidden mobile duplicates into image assets",()=>{
    for(const url of ['https://media-amazon.com.evil.test/a.jpg','http://127.0.0.1/a.jpg','https://u:p@m.media-amazon.com/a.jpg','javascript:alert(1)']) expect(amazonImageUrl(url)).toBeNull();
    const result=parseAmazonImageLayout(`<div id="aplus"><div class="a-hidden">${img('hidden')}</div>${img('safe')}<img src="https://evil.test/a.jpg"></div>`);
    expect(result.urls.aplus).toEqual(['https://m.media-amazon.com/images/I/safe.jpg']);
  });
  it("carries layout hashes through the native normalized snapshot",()=>{
    const html=`<input id="ASIN" value="B0FKN88MFL"><span id="productTitle">Vacuum</span><img id="landingImage" src="https://m.media-amazon.com/images/I/main.jpg"><div id="aplus">${img('wide')}</div>`;
    const product=parseBasicAmazonImages(html,'B0FKN88MFL');
    const normalized=normalizeAmazonArtifact({bytes:Buffer.from(JSON.stringify([product])),expectedAsin:'B0FKN88MFL',marketplace:'US'});
    expect(normalized.snapshot.sourceLayout?.modules[0].cards[0].images[0].hash).toBe(normalized.sourceAssets.find(a=>a.role==='aplus')?.sourceUrlHash);
  });
});
