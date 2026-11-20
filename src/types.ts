export interface Env {
  DB: D1Database;
  UPDATES: Queue<QueuedUpdate>;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  MUSE_API_KEY: string;
  MUSE_API_URL: string;
  MUSE_MODEL: string;
  MUSE_API_MODE?: string;
  MAX_MEDIA_BYTES?: string;
  CONTEXT_MESSAGES?: string;
}
export interface TelegramUser { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; }
export interface TelegramMessage {
  message_id: number; date: number;
  chat: { id: number; type: string; title?: string; username?: string };
  from?: TelegramUser; text?: string; caption?: string; reply_to_message?: TelegramMessage;
  photo?: Array<{file_id:string;file_unique_id:string;width:number;height:number;file_size?:number}>;
  document?: {file_id:string;file_unique_id:string;file_name?:string;mime_type?:string;file_size?:number};
  video?: {file_id:string;file_unique_id:string;mime_type?:string;file_size?:number};
  audio?: {file_id:string;file_unique_id:string;mime_type?:string;file_size?:number};
  voice?: {file_id:string;file_unique_id:string;mime_type?:string;file_size?:number};
  animation?: {file_id:string;file_unique_id:string;mime_type?:string;file_size?:number};
}
export interface TelegramUpdate { update_id:number; message?:TelegramMessage; edited_message?:TelegramMessage; }
export interface QueuedUpdate { update:TelegramUpdate; queuedAt:number; }
export interface GroupConfig { chat_id:string; title:string|null; enabled:number; mode:'mention'|'all'; muse_id:string|null; }
export interface MediaInput { type:'input_image'|'input_file'; dataUrl:string; filename:string; mimeType:string; }
