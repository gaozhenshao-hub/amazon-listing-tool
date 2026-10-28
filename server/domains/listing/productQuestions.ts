import * as XLSX from 'xlsx';
export type ProductQuestion = {type:'alexa'|'follow_up';question:string;parentQuestion?:string;questionCn?:string;answer?:string;answerCn?:string};
const normalized=(s:string)=>s.toLowerCase().replace(/[\s_\-（）()]/g,'');
const split=(value:unknown):string[]=>{
 const text=String(value??'').trim();if(!text)return [];
 if(text.startsWith('[')){try{const values=JSON.parse(text);if(Array.isArray(values))return values.map(String).map(s=>s.trim()).filter(Boolean);}catch{}}
 return text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
};
export function parseProductQuestions(book:XLSX.WorkBook){
 const result:Array<ProductQuestion&{asin?:string}>=[];
 for(const name of book.SheetNames){
  // Recommended products are not the owner of an Alexa export.
  if(/^(note|说明|products?|推荐产品)(\b|\()/i.test(name))continue;
  let previous:(ProductQuestion&{asin?:string})|undefined;
  for(const row of XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[name])){
   const entries=Object.entries(row).map(([key,value])=>[normalized(key),value] as const);
   const field=(aliases:string[])=>String(entries.find(([key])=>aliases.includes(key))?.[1]??'').trim();
   const asin=field(['asin','子asin','商品asin','产品asin','childasin','productasin','父asin','parentasin']).toUpperCase()||undefined;
   const main=field(['alexaquestion','alexaquestions','alexa问题','question','questions','问题','提问','相关问题','买家问题','rufus问题','rufusquestion']);
   const answer=field(['回答','答案','answer']);
   if(Object.values(row).some(v=>String(v).trim()==='翻译')){
    if(previous){if(main)previous.questionCn=main;if(answer)previous.answerCn=answer;}continue;
   }
   const type=field(['类型','type','questiontype','问题类型']);
   const isFollow=/follow|追问|更多问题|后续/i.test(type+' '+name);
   const parent=field(['原问题','主问题','parentquestion']);
   if(main){previous={asin,type:isFollow?'follow_up':'alexa',question:main,...(answer?{answer}:{}),...(parent?{parentQuestion:parent}:{})};result.push(previous);}
   for(const [key,value] of entries){if(/^(followupquestions?|更多问题|追问|后续问题)\d*$/.test(key))for(const question of split(value))result.push({asin,type:'follow_up',question,...(main&&!isFollow?{parentQuestion:main}:parent?{parentQuestion:parent}:{})});}
  }
 }
 return result;
}
export function mergeProductQuestions(base:ProductQuestion[],extra:ProductQuestion[]){
 const key=(q:ProductQuestion)=>JSON.stringify([q.type,q.question,q.parentQuestion||''].map(s=>s.replace(/\s+/g,' ').trim()));
 const seen=new Set(base.map(key));const result=[...base];
 for(const q of extra)if(!seen.has(key(q))){seen.add(key(q));result.push(q);}
 return result;
}

/** Match the subject of answers, excluding the comparison/recommendation section. */
export function matchQuestionBrand(questions:ProductQuestion[],records:Array<{asin:string;brand?:string|null}>){
 const answers=questions.filter(q=>q.type==='alexa'&&!/compar|similar|recommend|相似|比较|对比|推荐/i.test(q.question)).map(q=>q.answer||'').filter(Boolean);
 const candidates=records.filter(record=>{
  const brand=record.brand?.trim();if(!brand||/^(n\/?a|unknown|generic|未知)$/i.test(brand))return false;
  const escaped=brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matcher=new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'iu');
  return answers.some(answer=>matcher.test(answer));
 });
 return candidates.length===1?candidates[0].asin:undefined;
}
