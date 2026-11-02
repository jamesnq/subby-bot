import { describe,it,expect } from 'vitest';
import { csv,doseMessage,localDay,ADMIN,OWNER,type Dose } from '../src/modules/medication/ui';
const dose:Dose={id:'01234567-0123-0123-0123-012345678901',user_id:OWNER,day:'2026-11-02',test:false,scheduled_at:new Date('2026-11-02T14:00:00Z'),closes_at:new Date('2026-11-02T17:00:00Z'),title:'Mthi thúi đến giờ uống thuốc !!!',description:'Em thúi uống thuốc xong ấn confirm cho tôy nhé',status:'pending',taken_at:null,sends:0,attempts:0,last_error:null,message_id:null,channel_id:null};
describe('medication presentation',()=>{
 it('uses Vietnam calendar day across UTC midnight boundaries',()=>{expect(localDay(new Date('2026-12-31T18:00:00Z'))).toBe('2027-01-01');});
 it('shows pink theme, exact content and explains every action',()=>{
  const message=doseMessage(dose),embed=message.embeds[0].toJSON();
  expect(embed.color).toBe(0xff8fbe);expect(embed.title).toBe(dose.title);expect(embed.description).toBe(`**${dose.description}**`);
  for(const text of ['Confirm','15 phút','Bỏ qua','Lịch sử'])expect(JSON.stringify(message.embeds)).toContain(text);
  expect(message.components[0].components).toHaveLength(4);
 });
 it('disables mutations for completed doses but preserves history',()=>{
  const buttons=doseMessage({...dose,status:'taken',taken_at:new Date()}).components[0].components.map(b=>b.toJSON());
  expect(buttons.slice(0,3).every(b=>b.disabled)).toBe(true);expect(buttons[3].disabled).not.toBe(true);
 });
 it('isolates test history and prevents CSV formula injection',()=>{
  expect(JSON.stringify(doseMessage({...dose,user_id:ADMIN,test:true}))).toContain('med:history:test');
  expect(csv([{...dose,last_error:'=HYPERLINK("bad")'}])).toContain(`"'=HYPERLINK(""bad"")"`);
  expect(csv([dose])).toContain('21:00');
 });
});
