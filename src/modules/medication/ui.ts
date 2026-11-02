import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
export const OWNER = '640206627273965628';
export const ADMIN = '852584177382981643';
export const PINK = 0xff8fbe;
export const TZ = 'Asia/Ho_Chi_Minh';
export type Settings = { enabled:boolean; title:string; description:string; max_repeats:number };
export type Dose = { id:string; user_id:string; day:string; test:boolean; scheduled_at:Date; closes_at:Date; title:string; description:string; status:string; taken_at:Date|null; sends:number; attempts:number; last_error:string|null; message_id:string|null; channel_id:string|null };
export function localDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function stamp(value: Date|string): string {
  return new Intl.DateTimeFormat('vi-VN',{timeZone:TZ,dateStyle:'short',timeStyle:'short'}).format(new Date(value));
}
export function button(id:string,label:string,style=ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}
export function doseMessage(d:Dose) {
  const done=d.status!=='pending';
  const labels:Record<string,string>={pending:'🌷 Chưa xác nhận',taken:`💗 Đã uống${d.taken_at?' · '+stamp(d.taken_at):''}`,skipped:'⏭ Đã chọn bỏ qua',unconfirmed:'🌙 Chưa có xác nhận'};
  const embed=new EmbedBuilder().setColor(PINK)
    .setTitle(d.title)
    .setDescription(`**${d.description}**`)
    .addFields(
      {name:'🕘 Giờ uống',value:stamp(d.scheduled_at),inline:true},
      {name:'🌷 Trạng thái',value:labels[d.status]??d.status,inline:true})
    .setFooter({text:d.test?'🧪 BẢN TEST · Không tính vào lịch sử thật':'🎀 Mỗi tối 21:00 · Giờ Việt Nam'});
  const guide=new EmbedBuilder().setColor(0xfbd3e5)
    .setDescription([
      '**Các nút bên dưới**',
      '✅ **Confirm** · Đã uống, dừng nhắc.',
      '⏰ **15 phút** · Nhắc lại sau 15 phút, trong giới hạn đã đặt.',
      '⏭ **Bỏ qua** · Xác nhận bỏ qua lần này.',
      '📋 **Lịch sử** · Xem các lần uống trước.',
    ].join('\n'));
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`med:taken:${d.id}`,'✅ Confirm',ButtonStyle.Success).setDisabled(done),
    button(`med:snooze:${d.id}`,'⏰ 15 phút').setDisabled(done),
    button(`med:skip:${d.id}`,'⏭ Bỏ qua').setDisabled(done),
    button(`med:history:${d.test?'test':'live'}`,'📋 Lịch sử'));
  return {embeds:[embed,guide],components:[row],allowedMentions:{parse:[] as []}};
}
export function csv(rows:Dose[]):string {
  const cell=(v:unknown)=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
  return '\ufeff'+[['Ngày','Giờ dự kiến (VN)','Trạng thái','Giờ xác nhận (VN)','Lỗi gửi'],...rows.map(d=>[d.day,stamp(d.scheduled_at),d.status,d.taken_at?stamp(d.taken_at):'',d.last_error??''])].map(r=>r.map(cell).join(',')).join('\r\n');
}
