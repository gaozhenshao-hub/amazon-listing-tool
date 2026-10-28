import { expect, it } from "vitest";
import { parseAmazonImageLayout } from "./amazonImageLayout";
import { normalizeAmazonArtifact } from "./amazonNormalizer";
import { imageSubtypeFromLayout, validImageBelongSubtype } from "../../../shared/imageBelong";
const img = (name: string) => `<img src="https://m.media-amazon.com/images/I/${name}.jpg">`;
it("carries actual module classifications through normalization", () => {
  const rich = parseAmazonImageLayout(`<div id="aplus"><div class="aplus-module">${img('wide')}</div><div class="aplus-module"><div class="a-carousel-card">${img('slide')}</div></div><div class="aplus-module comparison">${img('comparison')}</div><div class="aplus-module">${['a','b','c','d'].map(n=>`<div class="apm-fourthcol">${img(n)}</div>`).join('')}</div></div>`);
  const result = normalizeAmazonArtifact({bytes:Buffer.from(JSON.stringify([{asin:'B0FKN88MFL',title:'test',sourceLayout:rich.layout,aPlusContent:rich.urls.aplus}])),expectedAsin:'B0FKN88MFL',marketplace:'US'});
  expect(result.sourceAssets.map(a=>a.moduleType)).toEqual(['全宽图','图片轮播','对比表格','四图文','四图文','四图文','四图文']);
  expect(result.snapshot.assets.map(a=>a.moduleType)).toEqual(result.sourceAssets.map(a=>a.moduleType));
});
it("classifies each story card and keeps backgrounds and unknown layouts unset", () => {
  const {layout} = parseAmazonImageLayout(`<div id="aplusBrandStory"><div class="apm-brand-story-background">${img('bg')}</div><div class="a-carousel-card">${['a','b','c','d'].map(img).join('')}</div><div class="a-carousel-card">${img('single')}</div></div>`);
  const m = layout.modules[0];
  expect(imageSubtypeFromLayout(layout,'brand_story',m.cards[0].images[0].hash)).toBe('四图组合');
  expect(imageSubtypeFromLayout(layout,'brand_story',m.cards[1].images[0].hash)).toBe('单图');
  expect(imageSubtypeFromLayout(layout,'brand_story',m.background!.hash)).toBeNull();
  expect(validImageBelongSubtype('A+','a_plus')).toBeNull();
  expect(imageSubtypeFromLayout(null,'aplus','a'.repeat(64))).toBeNull();
});
