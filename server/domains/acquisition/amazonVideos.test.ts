import {describe,it,expect} from "vitest";
import {load} from "cheerio";
import {mainAmazonVideo,amazonMediaUrl,downloadableAmazonVideo} from "./amazonVideos";
import {parseBasicAmazonImages} from "./basicAmazonProvider";
import {normalizeAmazonArtifact} from "./amazonNormalizer";
import {directIngestionBlockReason} from "./snapshotReview";
const media="https://m.media-amazon.com/images/S/example/";
describe("Amazon knowledge videos",()=>{
  it("ignores review/recommendation arrays even when they precede the product gallery",()=>{
    const array=(name:string)=>JSON.stringify([{url:media+name+'.mp4'}]);
    const html=`<div id="altImages"><div class="videoThumbnail"></div></div>
      <script>var related={"videos":${array('related')}};</script>
      <script>var reviews={"videos":${array('review')}};</script>
      <script>var imageBlock={"videos":${array('main')}};</script>`;
    expect(mainAmazonVideo(load(html)).map(v=>v.url)).toEqual([media+'main.mp4']);
    expect(mainAmazonVideo(load(`<script>var imageBlock={"videos":${array('main')}};</script>`))).toEqual([]);
  });
  it("excludes brand-story and page recommendation videos from A+ collection",()=>{
    const html=`<input id="ASIN" value="B0FKN88MFL"><span id="productTitle">Test</span><img id="landingImage" src="${media}main.jpg">
      <div id="aplus"><video src="${media}aplus.mp4" poster="${media}cover.jpg"></video>
      <div id="aplusBrandStory_feature_div"><video src="${media}brand.mp4"></video>
      <script>initVideo({videoUrl:"${media}brand-script.mp4"})</script></div></div>
      <video src="${media}recommendation.mp4"></video>`;
    expect(parseBasicAmazonImages(html,'B0FKN88MFL').videos.map(v=>v.url)).toEqual([media+'aplus.mp4']);
  });
  it("takes only the first gallery video and preserves its thumbnail position",()=>{
    const entries=[{url:media+'first.mp4',slateUrl:media+'cover.jpg',durationSeconds:26},{url:media+'second.mp4',slateUrl:media+'two.jpg'}];
    const html=`<div id="altImages"><div class="videoThumbnail"><span data-thumb-action='{"thumbnailIndex":3}'></span></div></div><script>var imageBlock={"videos":A.$.parseJSON('${JSON.stringify(entries)}')};</script>`;
    expect(mainAmazonVideo(load(html))).toMatchObject([{url:media+'first.mp4',role:'main',position:3,duration:26}]);
  });
  it("retains a first A+ video before image modules without tagging its cover",()=>{
    const escaped=(url:string)=>url.replaceAll('/','\\/').replaceAll('-','\\-');
    const html=`<input id="ASIN" value="B0FKN88MFL"><span id="productTitle">Test</span><img id="landingImage" src="${media}main.jpg"><div id="aplus"><div class="aplus-module premium-module-8"><script>initVideo({videoUrl:"${escaped(media+'default.jobtemplate.hls.m3u8')}",poster:"${escaped(media+'cover.jpg')}"})</script><img src="${media}cover.jpg"></div><div class="aplus-module"><img src="${media}wide.jpg"><script>hiddenSourceCode()</script><p>Visible description</p></div></div>`;
    const raw=parseBasicAmazonImages(html,'B0FKN88MFL');
    expect(raw.sourceLayout.modules.map(m=>m.kind)).toEqual(['video','image']);
    expect(raw.aPlusContent).toEqual([media+'wide.jpg']);
    expect(JSON.stringify(raw.sourceLayout)).not.toContain('hiddenSourceCode');
    const result=normalizeAmazonArtifact({bytes:Buffer.from(JSON.stringify([raw])),expectedAsin:'B0FKN88MFL',marketplace:'US'});
    expect(result.sourceAssets.filter(a=>a.role==='video')).toHaveLength(1);
    expect(result.snapshot.videos?.[0]).toMatchObject({role:'aplus',moduleId:'aplus-0',position:0});
    expect(JSON.stringify(result.snapshot.videos)).not.toContain('https:');
    expect(result.sourceAssets.filter(a=>a.role==='aplus').map(a=>a.sourceUrl)).toEqual([media+'wide.jpg']);
  });
  it("rejects untrusted destinations and unsupported streams",()=>{
    for(const url of ['https://media-amazon.com.evil.test/video.mp4','http://127.0.0.1/video.mp4','https://u:p@m.media-amazon.com/video.mp4','https://m.media-amazon.com:8443/video.mp4'])expect(amazonMediaUrl(url,'video')).toBeNull();
    expect(downloadableAmazonVideo(media+'default.jobtemplate.hls.m3u8')).toBe(media+'default.jobtemplate.mp4.480.mp4');
    expect(()=>downloadableAmazonVideo(media+'unknown.m3u8')).toThrow();
  });
  it("blocks automatic admission for any missing video or image",()=>{
    const main={role:'main',storageKey:'safe',fieldStatus:'pending_review'};
    const video={role:'video',storageKey:null,fieldStatus:'download_failed'};
    expect(directIngestionBlockReason({requestedCapabilities:['image_gallery'],requireComplete:true,assets:[main,video] as any})).toContain("视频");
    expect(directIngestionBlockReason({requestedCapabilities:['image_gallery'],requireComplete:true,assets:[main,video,{role:'aplus',storageKey:null}] as any})).toContain('仍有图片');
  });
});
