import type {Env,MediaInput} from './types';
export async function askMuse(env:Env,prompt:string,context:string,media?:MediaInput):Promise<string>{
 const content:Array<Record<string,string>>=[{type:'input_text',text:`Group context:\n${context}\n\nUser: ${prompt}`}];
 if(media){if(media.type==='input_image')content.push({type:'input_image',image_url:media.dataUrl});else content.push({type:'input_file',file_data:media.dataUrl,filename:media.filename});}
 const r=await fetch(env.MUSE_API_URL,{method:'POST',headers:{authorization:`Bearer ${env.MUSE_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:env.MUSE_MODEL,input:[{role:'user',content}]})});
 if(!r.ok)throw new Error(`Muse API status ${r.status}: ${(await r.text()).slice(0,400)}`);
 const body=await r.json() as {output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>};
 if(body.output_text)return body.output_text;
 return (body.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text||'').join('\n')||'Muse returned an empty response.';
}
