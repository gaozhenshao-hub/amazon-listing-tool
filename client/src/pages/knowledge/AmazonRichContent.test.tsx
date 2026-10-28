// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AmazonRichContent from "./AmazonRichContent";
afterEach(cleanup);
const hash=(n:number)=>String(n).repeat(64);
const ref=(n:number)=>({hash:hash(n),alt:`picture${n}`});
const card=(...ns:number[])=>({images:ns.map(ref),title:'',text:''});
const images=[1,2,3,4,5].map(n=>({id:n,imageUrl:`/stored/${n}.jpg`,sourceUrlHash:hash(n),imagePosition:'aplus'}));
describe('Amazon rich content',()=>{
 it('switches real carousel slides without loading every original',()=>{
   const layout={version:1,modules:[{id:'carousel',section:'aplus',kind:'carousel',title:'',background:null,cards:[card(1),card(2)],rows:[]}]};
   render(<AmazonRichContent layout={layout} images={images.slice(0,2)} section="aplus" onSelect={()=>{}}/>);
   expect(screen.getByRole('img',{name:'picture1'})).toBeTruthy();
   expect(screen.queryByRole('img',{name:'picture2'})).toBeNull();
   fireEvent.click(screen.getByRole('button',{name:'下一张'}));
   expect(screen.getByRole('img',{name:'picture2'})).toBeTruthy();
 });
 it('uses a separate brand background with a four-image card',()=>{
   const layout={version:1,modules:[{id:'story',section:'brand_story',kind:'brand_story',title:'Brand',background:ref(5),cards:[card(1,2,3,4)],rows:[]}]};
   const select = vi.fn();
   const {container}=render(<AmazonRichContent layout={layout} images={images} section="brand_story" onSelect={select}/>);
   expect(container.querySelector('img.object-cover')?.getAttribute('src')).toBe('/stored/5.jpg');
   expect(container.querySelector('.grid-cols-2')?.querySelectorAll('img').length).toBe(4);
   const spacer = screen.getByTestId('brand-story-leading-space');
   expect(spacer.parentElement?.firstElementChild).toBe(spacer);
   expect(spacer.className).toContain('w-[340px]');
   expect(spacer.className).not.toContain('bg-white');
   fireEvent.click(screen.getByRole('button',{name:'查看品牌故事背景图'}));
   expect(select).toHaveBeenCalledWith(images[4]);
 });
 it('changes labels with the active carousel slide',()=>{
   const layout={version:1,modules:[{id:'carousel',section:'aplus',kind:'carousel',title:'',background:null,cards:[card(1),card(2)],rows:[]}]};
   render(<AmazonRichContent layout={layout} images={images.slice(0,2)} section="aplus" onSelect={()=>{}} renderTags={visible=><aside>{visible.map(i=>`标签 ${i.id}`)}</aside>} />);
   expect(screen.getByText('标签 1')).toBeTruthy();
   fireEvent.click(screen.getByRole('button',{name:'下一张'}));
   expect(screen.getByText('标签 2')).toBeTruthy();
   expect(screen.queryByText('标签 1')).toBeNull();
 });
 it.each([3,4])('keeps a %s-column module together with only one editable label target',count=>{
   const layout={version:1,modules:[{id:'grid',section:'aplus',kind:'grid',subtype:count===3?'三图文':'四图文',cards:Array.from({length:count},(_,i)=>({...card(i+1),title:`Heading ${i+1}`,text:`Body ${i+1}`}))}]};
   const tags=vi.fn((visible:any[])=><aside>标签 {visible[0].id}</aside>);
   const {container}=render(<AmazonRichContent layout={layout} images={images.slice(0,count)} section="aplus" onSelect={()=>{}} renderTags={tags}/>);
   expect(container.querySelector('[style*="grid-template-columns"]')?.querySelectorAll('img')).toHaveLength(count);
   expect(tags).toHaveBeenCalledTimes(1);expect(tags.mock.calls[0][0].map(i=>i.id)).toEqual([1]);
   expect(screen.getByText(`Body ${count}`)).toBeTruthy();
 });
 it('renders small comparison images in one table row with aligned values',()=>{
   const layout={version:1,modules:[{id:'compare',section:'aplus',kind:'comparison',title:'Compare',background:null,cards:[card(1),card(2)],rows:[{label:'Size',cells:['.aplus-v2 .aplus-review-right-padding { padding-right: 0.1rem; } 10','20']}]}]};
   const {container}=render(<AmazonRichContent layout={layout} images={images.slice(0,2)} section="aplus" onSelect={()=>{}}/>);
   expect(container.querySelectorAll('thead tr img').length).toBe(2);
   expect(screen.queryByTestId('brand-story-leading-space')).toBeNull();
   expect(screen.getByRole('cell',{name:'20'})).toBeTruthy();
   expect(screen.getByRole('cell',{name:'10'})).toBeTruthy();
 });
});
