import {useState} from 'react';
import {Star} from 'lucide-react';
export function ReviewStars({rating}:{rating:number|null}){return <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={rating==null?'评分未知':`${rating} 星`}>{[1,2,3,4,5].map(n=><Star key={n} className={`h-3.5 w-3.5 ${rating!=null&&n<=Math.round(rating)?'fill-current':''}`}/>)}<span className="ml-1 text-xs text-muted-foreground">{rating??'未知'}</span></span>;}
export default function ReviewExcerpt({text}:{text:string}){const[open,setOpen]=useState(false);return <div><p className={`whitespace-pre-wrap break-words ${open?'':'line-clamp-3'}`}>{text}</p>{text.length>140&&<button type="button" className="mt-1 text-xs text-primary underline" onClick={()=>setOpen(!open)}>{open?'收起':'展开全文'}</button>}</div>;}
