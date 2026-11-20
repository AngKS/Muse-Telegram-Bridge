import type { Env, TelegramMessage } from './types';
const base = (env:Env, method:string) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
export async function telegramCall<T>(env:Env, method:string, payload:unknown):Promise<T> {
  const r=await fetch(base(env,method),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json() as {ok:boolean;result:T;description?:string};
  if(!r.ok||!data.ok) throw new Error(`Telegram ${method}: ${data.description||r.status}`);
  return data.result;
}
export async function sendMessage(env:Env,chatId:string|number,text:string,replyTo?:number) {
  return telegramCall(env,'sendMessage',{chat_id:chatId,text:text.slice(0,4096),reply_parameters:replyTo?{message_id:replyTo,allow_sending_without_reply:true}:undefined,disable_web_page_preview:true});
}
function b64(bytes:Uint8Array):string {let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function mime(path:string):string {const ext=path.split('.').pop()?.toLowerCase();return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',mp4:'video/mp4',mp3:'audio/mpeg',ogg:'audio/ogg'} as Record<string,string>)[ext||'']||'application/octet-stream';}
export async function getFileData(env:Env,fileId:string,max:number) {
  const f=await telegramCall<{file_path?:string;file_size?:number}>(env,'getFile',{file_id:fileId});
  if(!f.file_path)throw new Error('Telegram did not return a file path');
  if(f.file_size&&f.file_size>max)throw new Error('Attachment too large');
  const r=await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  if(!r.ok)throw new Error('Telegram file download failed');
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.byteLength>max)throw new Error('Attachment too large');
  const mt=r.headers.get('content-type')?.split(';')[0]||mime(f.file_path);
  return {dataUrl:`data:${mt};base64,${b64(bytes)}`,filename:f.file_path.split('/').pop()||'attachment',mimeType:mt};
}
export function attachmentFromMessage(m:TelegramMessage) {
  if(m.photo?.length){const p=m.photo[m.photo.length-1];return {fileId:p.file_id,type:'input_image' as const,filename:'photo.jpg',mimeType:'image/jpeg'};}
  for(const key of ['document','video','audio','voice','animation'] as const){const item=m[key];if(item)return {fileId:item.file_id,type:'input_file' as const,filename:('file_name' in item&&item.file_name)||key+'-'+item.file_unique_id,mimeType:('mime_type' in item&&item.mime_type)||'application/octet-stream'};}
  return null;
}
