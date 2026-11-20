import type {Env,TelegramMessage,TelegramUpdate,QueuedUpdate,GroupConfig,MediaInput} from './types';
import {attachmentFromMessage,getFileData,sendMessage,telegramCall} from './telegram';
import {askMuse} from './muse';

export default {
 async fetch(req:Request,env:Env):Promise<Response>{
  const url=new URL(req.url);
  if(url.pathname==='/health')return Response.json({ok:true,service:'muse-telegram-bridge'});
  if(url.pathname==='/telegram/webhook'&&req.method==='POST'){
   if(env.TELEGRAM_WEBHOOK_SECRET&&req.headers.get('x-telegram-bot-api-secret-token')!==env.TELEGRAM_WEBHOOK_SECRET)return new Response('Unauthorized',{status:401});
   let update:TelegramUpdate;try{update=await req.json() as TelegramUpdate;}catch{return new Response('Bad JSON',{status:400});}
   if(typeof update.update_id!=='number')return new Response('Missing update_id',{status:400});
   await env.UPDATES.send({update,queuedAt:Date.now()});return new Response('OK');
  }
  return new Response('Not found',{status:404});
 },
 async queue(batch:MessageBatch<QueuedUpdate>,env:Env):Promise<void>{
  for(const item of batch.messages){try{await processUpdate(item.body.update,env);item.ack();}catch(err){console.error('Update processing failed',err);await env.DB.prepare('DELETE FROM telegram_updates_processed WHERE update_id=?').bind(String(item.body.update.update_id)).run().catch(()=>{});item.retry();}}
 }
} satisfies ExportedHandler<Env,QueuedUpdate>;

async function processUpdate(update:TelegramUpdate,env:Env){
 const m=update.message||update.edited_message;if(!m||m.chat.type==='private')return;
 const chatId=String(m.chat.id),updateId=String(update.update_id);
 if(await env.DB.prepare('SELECT update_id FROM telegram_updates_processed WHERE update_id=?').bind(updateId).first())return;
 await env.DB.prepare('INSERT OR IGNORE INTO telegram_updates_processed(update_id) VALUES(?)').bind(updateId).run();
 await storeMessage(m,env);const cfg=await getGroup(chatId,m.chat.title||null,env);if(!cfg.enabled)return;
 const text=m.text||m.caption||'',command=text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
 if(command==='/musehelp'){await sendMessage(env,chatId,'Mention me, use /muse <question>, or reply to one of my messages.\n/musesummary · /musesettings · /musemode mention|all · /museon · /museoff',m.message_id);return;}
 if(command==='/musesettings'){await sendMessage(env,chatId,'Muse settings\nEnabled: '+(cfg.enabled?'yes':'no')+'\nMode: '+cfg.mode,m.message_id);return;}
 if(['/museon','/museoff','/musemode'].includes(command)){
  if(!await isAdmin(chatId,m.from?.id,env)){await sendMessage(env,chatId,'Only group admins can change settings.',m.message_id);return;}
  if(command==='/museon'||command==='/museoff')await env.DB.prepare('UPDATE telegram_groups SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(command==='/museon'?1:0,chatId).run();
  else{const mode=text.trim().split(/\s+/)[1]?.toLowerCase();if(mode!=='mention'&&mode!=='all'){await sendMessage(env,chatId,'Usage: /musemode mention or all',m.message_id);return;}await env.DB.prepare('UPDATE telegram_groups SET mode=?,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(mode,chatId).run();}
  await sendMessage(env,chatId,'Group settings updated.',m.message_id);return;
 }
 if(command==='/musesummary'){await respondWithMuse(m,'Summarize recent discussion, decisions, and action items.',env,cfg);return;}
 const bot=await telegramCall<{username:string}>(env,'getMe',{}),mentioned=text.toLowerCase().includes('@'+bot.username.toLowerCase()),replied=!!m.reply_to_message?.from?.is_bot,isMuseCommand=command==='/muse';
 const invoked=isMuseCommand||mentioned||replied||(cfg.mode==='all'&&!text.startsWith('/')),attachment=attachmentFromMessage(m);
 if(!invoked||(!text.trim()&&!attachment))return;
 const prompt=isMuseCommand?text.replace(/^\/muse(?:@\w+)?\s*/i,''):text.replace('@'+bot.username,'').trim();
 await respondWithMuse(m,prompt,env,cfg);
}
async function respondWithMuse(m:TelegramMessage,prompt:string,env:Env,cfg:GroupConfig){
 const chatId=String(m.chat.id),limit=Math.min(50,Math.max(1,Number(env.CONTEXT_MESSAGES)||20));
 const rows=await env.DB.prepare('SELECT sender_name,content FROM telegram_messages WHERE chat_id=? ORDER BY id DESC LIMIT ?').bind(chatId,limit).all<{sender_name:string|null;content:string}>();
 const context=(rows.results||[]).reverse().map(x=>(x.sender_name||'Member')+': '+x.content).join('\n');
 let media:MediaInput|undefined;const meta=attachmentFromMessage(m);
 if(meta){try{const f=await getFileData(env,meta.fileId,Math.min(20*1024*1024,Math.max(1024,Number(env.MAX_MEDIA_BYTES)||8388608)));media={type:meta.type,dataUrl:f.dataUrl,filename:f.filename,mimeType:f.mimeType};}catch(e){await sendMessage(env,chatId,'Attachment error: '+(e instanceof Error?e.message:'unknown error'),m.message_id);return;}}
 await telegramCall(env,'sendChatAction',{chat_id:chatId,action:'typing'}).catch(()=>{});
 try{const answer=await askMuse(env,prompt||'Please analyze the attachment.','Group: '+(m.chat.title||chatId)+'\nMode: '+cfg.mode+'\nRecent messages:\n'+context,media);await sendMessage(env,chatId,answer,m.message_id);}
 catch(e){console.error('Muse API failed',e);await sendMessage(env,chatId,'Muse could not be reached. Please try again shortly.',m.message_id);}
}
async function storeMessage(m:TelegramMessage,env:Env){
 const media=attachmentFromMessage(m),content=m.text||m.caption||(media?'[Attachment]':'');
 await env.DB.prepare('INSERT OR IGNORE INTO telegram_messages(chat_id,message_id,sender_id,sender_name,content,reply_to_message_id,media_type,media_file_id) VALUES(?,?,?,?,?,?,?,?)').bind(String(m.chat.id),String(m.message_id),m.from?String(m.from.id):null,m.from?[m.from.first_name,m.from.last_name].filter(Boolean).join(' '):'Member',content,m.reply_to_message?String(m.reply_to_message.message_id):null,media?.type||null,media?.fileId||null).run();
}
async function getGroup(chatId:string,title:string|null,env:Env):Promise<GroupConfig>{
 await env.DB.prepare('INSERT OR IGNORE INTO telegram_groups(chat_id,title) VALUES(?,?)').bind(chatId,title).run();
 if(title)await env.DB.prepare('UPDATE telegram_groups SET title=? WHERE chat_id=?').bind(title,chatId).run();
 return (await env.DB.prepare('SELECT chat_id,title,enabled,mode,muse_id FROM telegram_groups WHERE chat_id=?').bind(chatId).first<GroupConfig>())!;
}
async function isAdmin(chatId:string,userId:number|undefined,env:Env):Promise<boolean>{
 if(!userId)return false;const admins=await telegramCall<Array<{user:{id:number};status:string}>>(env,'getChatAdministrators',{chat_id:chatId});
 return admins.some(x=>x.user.id===userId&&(x.status==='administrator'||x.status==='creator'));
}
