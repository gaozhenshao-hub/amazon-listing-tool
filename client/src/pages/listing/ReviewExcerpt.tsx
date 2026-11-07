import {useState} from 'react';
import {Star} from 'lucide-react';
export function starFill(rating:number|null,n:number):'full'|'half'|'empty' {
 if(rating===null || !Number.isFinite(rating)) return 'empty';
 const safe=Math.max(0,Math.min(5,rating)), whole=Math.floor(safe), fraction=Math.round((safe-whole)*1000)/1000;
 const rounded=whole+(fraction<0.3?0:fraction<0.8?0.5:1);
 return n<=rounded?'full':n-0.5===rounded?'half':'empty';
}
export function ReviewStars({rating}:{rating:number|null}){return <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={rating==null?'评分未知':`${rating} 星`}>{[1,2,3,4,5].map(n=>{const fill=starFill(rating,n);return <span key={n} className="relative inline-flex" data-star-fill={fill}><Star className={`h-3.5 w-3.5 ${fill==='full'?'fill-current':''}`}/>{fill==='half'&&<span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden"><Star className="h-3.5 w-3.5 fill-current"/></span>}</span>;})}<span className="ml-1 text-xs text-muted-foreground">{rating??'未知'}</span></span>;}
export default function ReviewExcerpt({text}:{text:string}){const[open,setOpen]=useState(false);return <div><p className={`whitespace-pre-wrap break-words ${open?'':'line-clamp-3'}`}>{text}</p>{text.length>140&&<button type="button" className="mt-1 text-xs text-primary underline" onClick={()=>setOpen(!open)}>{open?'收起':'展开全文'}</button>}</div>;}
