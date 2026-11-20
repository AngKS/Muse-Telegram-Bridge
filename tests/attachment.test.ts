import {describe,it,expect} from 'vitest';
import {attachmentFromMessage} from '../src/telegram';
describe('attachmentFromMessage',()=>{
it('selects the largest Telegram photo size',()=>{const msg:any={message_id:1,date:0,chat:{id:1,type:'group'},photo:[{file_id:'small',file_unique_id:'s',width:10,height:10},{file_id:'large',file_unique_id:'l',width:100,height:100}]};expect(attachmentFromMessage(msg)?.fileId).toBe('large');});
it('returns null without media',()=>{const msg:any={message_id:1,date:0,chat:{id:1,type:'group'},text:'hello'};expect(attachmentFromMessage(msg)).toBeNull();});});