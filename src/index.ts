import type {Env,TelegramMessage,TelegramUpdate,QueuedUpdate,GroupConfig,MediaInput} from './types';
import {attachmentFromMessage,getFileData,sendMessage,telegramCall} from './telegram';
import {askMuse} from './muse';
export default {
 async fetch(req:Request,env:Env):Promise<Response>{
  const u=new URL(req.url);
  if(u.pathname==='/health')return Response.json({ok:true,service:'muse-telegram-bridge'});
  if(u.pathname==='/telegram/webhook'&&req.method==='POST'){
   if(env.TELEGRAM_WEBHOOK_SECRET&&req.headers.get('x-telegram-bot-api-secret-token')!==env.TELEGRAM_WEBHOOK_SECRET)return new Response('Unauthorized',{status:401});
   let update:TelegramUpdate;try{update=await req.json() as TelegramUpdate;}catch{return new Response('Bad JSON',{status:400});}
   if(typeof update.update_id!=='number')return new Response('Missing update id',{status:400});
   await env.UPDATES.send({update,queuedAt:Date.now()});return new Response('OK');
  }return new Response('Not found',{status:404});
 },
 async queue(batch:MessageBatch<QueuedUpdate>,env:Env):Promise<void>{
  for(const item of batch.messages){try{await process(item.body.update,env);item.ack();}catch(e){console.error(e);await env.DB.prepare('DELETE FROM telegram_updates_processed WHERE update_id=?').bind(String(item.body.update.update_id)).run().catch(()=>{});item.retry();}}
 }
} satisfies ExportedHandler<Env,QueuedUpdate>;
async function process(update:TelegramUpdate,env:Env){
 const m=update.message||update.edited_message;if(!m||m.chat.type==='private')return;
 const chat=String(m.chat.id),id=String(update.update_id);
 if(await env.DB.prepare('SELECT update_id FROM telegram_updates_processed WHERE update_id=?').bind(id).first())return;
 await env.DB.prepare('INSERT OR IGNORE INTO telegram_updates_processed(update_id) VALUES(?)').bind(id).run();
 await store(m,env);const cfg=await group(chat,m.chat.title||null,env);if(!cfg.enabled)return;
 const text=m.text||m.caption||'',cmd=text.split(/\\s+/)[0].split('@')[0].toLowerCase();
 if(cmd==='/musehelp'){await sendMessage(env,chat,'Mention Muse, /muse <question>, or reply to Muse. /musesummary /musesettings /musemode mention|all /museon /museoff',m.message_id);return;}
 if(cmd==='/musesettings'){await sendMessage(env,chat,'Muse settings\\nEnabled: '+(cfg.enabled?'yes':'no')+'\\nMode: '+cfg.mode,m.message_id);return;}
 if(['/museon','/museoff','/musemode'].includes(cmd)){
  if(!await isAdmin(chat,m.from?.id,env)){await sendMessage(env,chat,'Only group admins can change settings.',m.message_id);return;}
  if(cmd==='/museon'||cmd==='/museoff')await env.DB.prepare('UPDATE telegram_groups SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(cmd==='/museon'?1:0,chat).run();
  else{const mode=text.split(/\\s+/)[1]?.toLowerCase();if(mode!=='mention'&&mode!=='all'){await sendMessage(env,chat,'Usage: /musemode mention or all',m.message_id);return;}await env.DB.prepare('UPDATE telegram_groups SET mode=?,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(mode,chat).run();}
  await sendMessage(env,chat,'Group settings updated.',m.message_id);return;
 }
 if(cmd==='/musesummary'){await respond(m,'Summarize recent discussion, decisions, and action items.',env,cfg);return;}
 const bot=await telegramCall<{username:string}>(env,'getMe',{}),mentioned=text.toLowerCase().includes('@'+bot.username.toLowerCase()),replied=!!m.reply_to_message?.from?.is_bot,isCmd=cmd==='/muse';
 const trigger=isCmd||mentioned||replied||(cfg.mode==='all'&&!text.startsWith('/')),media=attachmentFromMessage(m);
 if(!trigger||(!text.trim()&&!media))return;
 const prompt=isCmd?text.replace(/^\\/muse(?:@\\w+)?\\s*/i,''):text.replace('@'+bot.username,'').trim();
 await respond(m,prompt,env,cfg);
}
async function respond(m:TelegramMessage,prompt:string,env:Env,cfg:GroupConfig){
 const chat=String(m.chat.id),limit=Math.min(50,Math.max(1,Number(env.CONTEXT_MESSAGES)||20));
 const result=await env.DB.prepare('SELECT sender_name,content FROM telegram_messages WHERE chat_id=? ORDER BY id DESC LIMIT ?').bind(chat,limit).all<{sender_name:string|null;content:string}>();
 const context=(result.results||[]).reverse().map(x=>(x.sender_name||'Member')+': '+x.content).join('\\n');
 let media:MediaInput|undefined;const meta=attachmentFromMessage(m);
 if(meta){try{const f=await getFileData(env,meta.fileId,Math.min(20*1024*1024,Math.max(1024,Number(env.MAX_MEDIA_BYTES)||8388608)));media={type:meta.type,dataUrl:f.dataUrl,filename:f.filename,mimeType:f.mimeType};}catch(e){await sendMessage(env,chat,'Attachment error: '+(e instanceof Error?e.message:'unknown'),m.message_id);return;}}
 await telegramCall(env,'sendChatAction',{chat_id:chat,action:'typing'}).catch(()=>{});
 try{const answer=await askMuse(env,prompt||'Please analyze the attachment.', 'Group: '+(m.chat.title||chat)+'\\nMode: '+cfg.mode+'\\nRecent messages:\\n'+context,media);await sendMessage(env,chat,answer,m.message_id);}
 catch(e){console.error('Muse call failed',e);await sendMessage(env,chat,'Muse could not be reached. Try again shortly.',m.message_id);}
}
async function store(m:TelegramMessage,env:Env){
 const a=attachmentFromMessage(m),content=m.text||m.caption||(a?'[Attachment]':'');
 await env.DB.prepare('INSERT OR IGNORE INTO telegram_messages(chat_id,message_id,sender_id,sender_name,content,reply_to_message_id,media_type,media_file_id) VALUES(?,?,?,?,?,?,?,?)').bind(String(m.chat.id),String(m.message_id),m.from?String(m.from.id):null,m.from?[m.from.first_name,m.from.last_name].filter(Boolean).join(' '):'Member',content,m.reply_to_message?String(m.reply_to_message.message_id):null,a?.type||null,a?.fileId||null).run();
}
async function group(chat:string,title:string|null,env:Env):Promise<GroupConfig>{
 await env.DB.prepare('INSERT OR IGNORE INTO telegram_groups(chat_id,title) VALUES(?,?)').bind(chat,title).run();
 if(title)await env.DB.prepare('UPDATE telegram_groups SET title=? WHERE chat_id=?').bind(title,chat).run();
 return (await env.DB.prepare('SELECT chat_id,title,enabled,mode,muse_id FROM telegram_groups WHERE chat_id=?').bind(chat).first<GroupConfig>())!;
}
async function isAdmin(chat:string,user:number|undefined,env:Env):Promise<boolean>{
 if(!user)return false;const admins=await telegramCall<Array<{user:{id:number};status:string}>>(env,'getChatAdministrators',{chat_id:chat});
 return admins.some(x=>x.user.id===user&&(x.status==='administrator'||x.status==='creator'));
}
