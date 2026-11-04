import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, EmbedBuilder, InteractionContextType, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle, type Interaction, type Client } from 'discord.js';
import { pool } from '@infra/database/pool';
import { ADMIN, OWNER, PINK, button, csv, doseMessage, localDay, stamp, type Dose } from './ui';
import { history, settings, sendTest, refreshMessages, notifyAdmin } from './service';
export const medicationCommand=new SlashCommandBuilder().setName('thuoc').setDescription('🌸 Nhắc uống thuốc và lịch sử')
  .setContexts(InteractionContextType.Guild,InteractionContextType.BotDM)
  .addSubcommand(s=>s.setName('panel').setDescription('🎀 Panel quản trị nhắc thuốc'))
  .addSubcommand(s=>s.setName('lichsu').setDescription('📋 Lịch sử 30 ngày'))
  .addSubcommand(s=>s.setName('tuan').setDescription('💕 Tổng kết 7 ngày'))
  .addSubcommand(s=>s.setName('thang').setDescription('🌷 Tổng kết 30 ngày'))
  .addSubcommand(s=>s.setName('csv').setDescription('📎 Xuất lịch sử 365 ngày'));
async function panel() {
  const s=await settings();
  const last=(await pool.query<Dose>("SELECT *,day::text FROM medication_doses WHERE test=false ORDER BY scheduled_at DESC LIMIT 1")).rows[0];
  const embed=new EmbedBuilder().setColor(PINK).setTitle('🎀 Góc chăm sóc Mthi')
    .setDescription(`${s.enabled?'🟢 Đang bật':'⚪ Đang tắt'} · 21:00 mỗi ngày (Việt Nam)\nNhắc lại sau 15 phút · tối đa ${s.max_repeats} lần\nNgười nhận: <@${OWNER}>\nTest: <@${ADMIN}>`)
    .addFields({name:'Title',value:s.title},{name:'Description',value:s.description},
      {name:'Theo dõi gần nhất',value:last?`${stamp(last.scheduled_at)} · ${last.status}\nĐã gửi ${last.sends} tin${last.last_error?' · Lỗi: '+last.last_error:''}`:'Chưa có lần nhắc thật nào.'});
  return {embeds:[embed],components:[
    new ActionRowBuilder<ButtonBuilder>().addComponents(button(`med:enabled:${s.enabled?'off':'on'}`,s.enabled?'🔕 Tắt thông báo':'🔔 Bật thông báo'),button('med:edit','✏️ Nội dung'),button('med:limit','⏰ Giới hạn nhắc'),button('med:test','🧪 Gửi test'),button('med:edit-history','📝 Sửa lịch sử')),
    new ActionRowBuilder<ButtonBuilder>().addComponents(button('med:week:live','💕 Tuần'),button('med:month:live','🌷 Tháng'),button('med:csv:live','📎 CSV'),button('med:history:test','🧪 Lịch sử test'),button('med:panel','🔄 Cập nhật'))]};
}
export function report(rows:Dose[],days:number,test:boolean,page=0) {
  const count=(s:string)=>rows.filter(d=>d.status===s).length;
  const statuses:Record<string,string>={taken:'✅ Đã uống',skipped:'⏭ Đã bỏ qua',unconfirmed:'🌙 Chưa xác nhận',pending:'⏳ Đang chờ'};
  const embed=new EmbedBuilder().setColor(PINK).setTitle(`🌷 ${test?'TEST · ':''}Lịch sử uống thuốc · ${days} ngày`)
    .setDescription([
      `• **Tổng số:** ${rows.length} lần`,
      `• **Đã uống:** ${count('taken')} lần`,
      `• **Đã bỏ qua:** ${count('skipped')} lần`,
      `• **Chưa xác nhận:** ${count('unconfirmed')} lần`,
      `• **Đang chờ:** ${count('pending')} lần`,
      `• **Tỷ lệ xác nhận:** ${rows.length?Math.round(count('taken')*100/rows.length):0}%`,
      `• **Lỗi gửi thông báo:** ${rows.filter(d=>d.last_error).length} lần`,
    ].join('\n'))
    .setFooter({text:`🎀 Trang ${page+1} · Giờ Việt Nam`});
  const slice=rows.slice(page*10,page*10+10);
  for(const d of slice) {
    const [year,month,day]=d.day.split('-');
    embed.addFields({name:`📅 ${day}/${month}/${year}`,value:[
      `• **Trạng thái:** ${statuses[d.status]??d.status}`,
      `• **Giờ nhắc:** ${stamp(d.scheduled_at)}`,
      `• **Giờ xác nhận:** ${d.taken_at?stamp(d.taken_at):'—'}`,
      ...(d.last_error?['• **Thông báo:** ⚠️ Gửi không thành công']:[]),
    ].join('\n')});
  }
  if(!slice.length)embed.addFields({name:'📋 Các lần uống',value:'Chưa có dữ liệu trong khoảng thời gian này.'});
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`med:page:${test?'test':'live'}:${Math.max(0,page-1)}`,'← Trước').setDisabled(page===0),
    button(`med:page:${test?'test':'live'}:${page+1}`,'Sau →').setDisabled((page+1)*10>=rows.length),
    button(`med:csv:${test?'test':'live'}`,'📎 CSV'));
  return {embeds:[embed],components:[row]};
}
export async function handleMedication(i:Interaction,client:Client):Promise<boolean> {
  const command=i.isChatInputCommand()&&i.commandName==='thuoc';
  if(!command && !((i.isButton()||i.isModalSubmit())&&i.customId.startsWith('med:')))return false;
  if(!i.isChatInputCommand()&&!i.isButton()&&!i.isModalSubmit())return false;
  const admin=i.user.id===ADMIN;
  if(!admin&&i.user.id!==OWNER){await i.reply({content:'Bạn không có quyền dùng tính năng này.',flags:MessageFlags.Ephemeral});return true;}
  const parts=i.isChatInputCommand()?['med',({panel:'panel',lichsu:'history',tuan:'week',thang:'month',csv:'csv'} as Record<string,string>)[i.options.getSubcommand()],'live']:i.customId.split(':');
  const action=parts[1];
  const adminActions=['panel','edit','save','enabled','test','limit','save-limit','edit-history','save-history'];
  if(adminActions.includes(action)&&!admin){await i.reply({content:'Chỉ admin được thay đổi lịch nhắc.',flags:MessageFlags.Ephemeral});return true;}
  if(i.isButton()&&action==='edit-history') {
    const day=new TextInputBuilder().setCustomId('day').setLabel('Ngày của lượt nhắc (YYYY-MM-DD)')
      .setStyle(TextInputStyle.Short).setMaxLength(10).setValue(localDay());
    const status=new TextInputBuilder().setCustomId('status').setLabel('1 Đã uống · 2 Bỏ qua · 3 Chưa xác nhận')
      .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(1);
    const modal=new ModalBuilder().setCustomId('med:save-history').setTitle('📝 Sửa lịch sử uống thuốc')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(day),new ActionRowBuilder<TextInputBuilder>().addComponents(status));
    await i.showModal(modal);return true;
  }
  if(i.isButton()&&(action==='edit'||action==='limit')) {
    const s=await settings();
    const modal=new ModalBuilder().setCustomId(action==='edit'?'med:save':'med:save-limit').setTitle('🎀 Cài đặt nhắc thuốc');
    const fields=action==='edit'?[new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setMaxLength(256).setValue(s.title),new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setMaxLength(1800).setValue(s.description)]:[new TextInputBuilder().setCustomId('limit').setLabel('Số lần nhắc lại (0–5), cách nhau 15 phút').setStyle(TextInputStyle.Short).setValue(String(s.max_repeats))];
    modal.addComponents(...fields.map(f=>new ActionRowBuilder<TextInputBuilder>().addComponents(f)));
    await i.showModal(modal);return true;
  }
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(action==='save-history'&&i.isModalSubmit()) {
    const day=i.fields.getTextInputValue('day').trim();
    const choice=i.fields.getTextInputValue('status').trim();
    const date=new Date(`${day}T00:00:00Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day.startsWith('0000')||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==day||! /^[1-3]$/.test(choice)) {
      await i.editReply('Nhập ngày hợp lệ theo YYYY-MM-DD và chọn trạng thái 1, 2 hoặc 3.');return true;
    }
    const status=['taken','skipped','unconfirmed'][Number(choice)-1];
    const {rows:[dose]}=await pool.query<Dose>(`
      WITH updated AS (
        UPDATE medication_doses
        SET status=$3, taken_at=CASE WHEN $3='taken' THEN taken_at ELSE NULL END,
            admin_notify_due_at=CASE WHEN status=$3 THEN admin_notify_due_at ELSE NULL END
        WHERE user_id=$1 AND day=$2 AND test=false
        RETURNING *
      ), audit AS (
        INSERT INTO medication_audit(actor_id,action,dose_id)
        SELECT $4,'history:' || status,id FROM updated
      )
      SELECT *,day::text FROM updated`,[OWNER,day,status,i.user.id]);
    if(!dose){await i.editReply('Không tìm thấy lượt nhắc thật cho ngày này.');return true;}
    await i.editReply({content:`Đã cập nhật lượt nhắc ngày ${day}.`,...doseMessage(dose)});
    await refreshMessages(client,dose);
    return true;
  } else if(action==='save'&&i.isModalSubmit()) {
    const title=i.fields.getTextInputValue('title').trim(),description=i.fields.getTextInputValue('description').trim();
    if(!title||!description||title.length>256||description.length>1800){await i.editReply('Nội dung không hợp lệ.');return true;}
    await pool.query('UPDATE medication_settings SET title=$1,description=$2,updated_at=now() WHERE id=1',[title,description]);
  } else if(action==='save-limit'&&i.isModalSubmit()) {
    const raw=i.fields.getTextInputValue('limit');
    if(!/^[0-5]$/.test(raw)){await i.editReply('Nhập số nguyên từ 0 đến 5.');return true;}
    await pool.query('UPDATE medication_settings SET max_repeats=$1,updated_at=now() WHERE id=1',[Number(raw)]);
  } else if(action==='enabled') {
    const conn=await pool.connect();
    try {
      await conn.query('BEGIN');
      await conn.query('UPDATE medication_settings SET enabled=$1,updated_at=now() WHERE id=1',[parts[2]==='on']);
      // Resume affects future doses only; never burst reminders paused earlier.
      await conn.query("UPDATE medication_doses SET status='unconfirmed' WHERE status='pending'");
      await conn.query('COMMIT');
    } catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
  } else if(action==='test') {
    const msg=await sendTest(client);await i.editReply(`🧪 Đã gửi embed test vào DM admin: ${msg.url}`);return true;
  } else if(['history','week','month','csv','page'].includes(action)) {
    const test=parts[2]==='test';
    if(test&&!admin){await i.editReply('Chỉ admin xem dữ liệu test.');return true;}
    const days=action==='week'?7:action==='csv'?365:30;
    const rows=await history(test?ADMIN:OWNER,test,days);
    if(action==='csv')await i.editReply({content:'🌸 Lịch sử riêng tư · giờ Việt Nam',files:[new AttachmentBuilder(Buffer.from(csv(rows),'utf8'),{name:`lich-uong-thuoc-${test?'test':'live'}.csv`})]});
    else await i.editReply(report(rows,days,test,Math.min(36,Math.max(0,Number(parts[3])||0))));
    return true;
  } else if(['taken','snooze','skip','skip-confirm'].includes(action)) {
    const id=parts[2];
    if(!/^[\da-f-]{36}$/i.test(id)){await i.editReply('Lần nhắc không hợp lệ.');return true;}
    if(action==='skip') {
      const own=await pool.query('SELECT 1 FROM medication_doses WHERE id=$1 AND user_id=$2',[id,i.user.id]);
      if(!own.rowCount){await i.editReply('Đây không phải lần nhắc của bạn.');return true;}
      await i.editReply({content:'Bạn muốn ghi nhận bỏ qua lần này?',components:[new ActionRowBuilder<ButtonBuilder>().addComponents(button(`med:skip-confirm:${id}`,'⏭ Xác nhận bỏ qua'))]});return true;
    }
    const conn=await pool.connect();let dose:Dose|undefined;
    try {
      await conn.query('BEGIN');
      const row=(await conn.query<Dose & { confirm_until:Date }>(`
        SELECT *,day::text,CASE WHEN test THEN closes_at ELSE scheduled_at+interval '24 hours' END AS confirm_until
        FROM medication_doses WHERE id=$1 AND user_id=$2 FOR UPDATE`,[id,i.user.id])).rows[0];
      dose=row;
      if(!dose){await conn.query('ROLLBACK');await i.editReply('Đây không phải lần nhắc của bạn.');return true;}
      const now=new Date();
      const canConfirm=action==='taken'&&(dose.status==='pending'||(!dose.test&&dose.status==='unconfirmed'));
      const deadline=canConfirm?row.confirm_until:dose.closes_at;
      if(canConfirm&&deadline<=now) {
        await conn.query('ROLLBACK');await i.editReply('Đã hết thời gian xác nhận cho lượt này.');return true;
      }
      if(!canConfirm&&(dose.status!=='pending'||deadline<=now)) {
        await conn.query('ROLLBACK');await i.editReply(`Lần nhắc đã đóng hoặc đã xử lý (${dose.status}).`);return true;
      }
      if(action==='snooze') {
        await conn.query("UPDATE medication_doses SET next_send_at=now()+interval '15 minutes' WHERE id=$1",[id]);
      }else {
        dose=(await conn.query<Dose>("UPDATE medication_doses SET status=$2,taken_at=CASE WHEN $2='taken' THEN now() ELSE NULL END,admin_notify_due_at=CASE WHEN $2='taken' AND test=false THEN now() ELSE NULL END WHERE id=$1 RETURNING *,day::text",[id,action==='taken'?'taken':'skipped'])).rows[0];
      }
      await conn.query('INSERT INTO medication_audit(actor_id,action,dose_id) VALUES($1,$2,$3)',[i.user.id,action,id]);
      await conn.query('COMMIT');
    }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
    if(action==='snooze') {
      const s=await settings();await i.editReply(dose!.sends>=s.max_repeats+1?'Đã đạt giới hạn nhắc lại; bạn vẫn có thể Confirm.':'⏰ Sẽ nhắc lại sau 15 phút nếu chưa Confirm và thông báo đang bật.');
    }else {
      await i.editReply(doseMessage(dose!));await refreshMessages(client,dose!);
      if(action==='taken'&&!dose!.test)await notifyAdmin(client);
    }
    return true;
  }
  if(adminActions.includes(action))await pool.query('INSERT INTO medication_audit(actor_id,action) VALUES($1,$2)',[i.user.id,action]);
  await i.editReply(await panel());return true;
}
