import { createHash } from 'node:crypto';
import { EmbedBuilder, type Client } from 'discord.js';
import { pool } from '@infra/database/pool';
import { logger } from '@shared/logger';
import { medicationSchema } from './schema';
import { ADMIN, OWNER, PINK, stamp, localDay, doseMessage, type Dose, type Settings } from './ui';
export async function initMedication() { await pool.query(medicationSchema); }
export async function settings():Promise<Settings> { return (await pool.query('SELECT * FROM medication_settings WHERE id=1')).rows[0]; }
export async function history(user:string,test:boolean,days:number):Promise<Dose[]> {
  return (await pool.query<Dose>(`SELECT *,day::text FROM medication_doses WHERE user_id=$1 AND test=$2 AND day >= ($3::date-($4::int-1)) ORDER BY scheduled_at DESC LIMIT 366`,[user,test,localDay(),days])).rows;
}
export async function createTest():Promise<Dose> {
  const s=await settings();
  // Reuse the day's test: never erase a previous test confirmation.
  return (await pool.query<Dose>(`INSERT INTO medication_doses(user_id,day,test,scheduled_at,closes_at,title,description) VALUES($1,$2,true,now(),now()+interval '1 hour',$3,$4) ON CONFLICT(user_id,day,test) DO UPDATE SET title=excluded.title,description=excluded.description RETURNING *,day::text`,[ADMIN,localDay(),s.title,s.description])).rows[0];
}
export async function sendTest(client:Client) {
  const dose=await createTest();
  const user=await client.users.fetch(ADMIN);
  const msg=await user.send(doseMessage(dose));
  await pool.query("UPDATE medication_doses SET message_id=$2,channel_id=$3,sends=GREATEST(sends,1),attempts=0,last_error=NULL,next_send_at=now()+interval '15 minutes' WHERE id=$1",[dose.id,msg.id,msg.channelId]);
  return msg;
}
export async function refreshMessages(client:Client,d:Dose) {
  // All repeats carry the same dose ID; old buttons remain idempotent.
  if(!d.message_id||!d.channel_id)return;
  try { const user=await client.users.fetch(d.user_id); const channel=await user.createDM(); await channel.messages.edit(d.message_id,doseMessage(d)); }
  catch { logger.warn({doseId:d.id},'Medication message could not be refreshed'); }
}
// A durable outbox: confirmation succeeds even if the admin DM is temporarily unavailable.
export async function notifyAdmin(client:Client) {
  const conn=await pool.connect();
  try {
    await conn.query('BEGIN');
    const dose=(await conn.query<Dose>(`SELECT *,day::text FROM medication_doses
      WHERE test=false AND user_id=$1 AND status='taken' AND admin_notified_at IS NULL
      AND admin_notify_due_at<=now() AND admin_notify_attempts<3
      ORDER BY admin_notify_due_at FOR UPDATE SKIP LOCKED LIMIT 1`,[OWNER])).rows[0];
    if(!dose){await conn.query('COMMIT');return;}
    try {
      const user=await client.users.fetch(ADMIN);
      const embed=new EmbedBuilder().setColor(PINK).setTitle('💗 Mthi đã uống thuốc rồi!')
        .setDescription(`<@${OWNER}> đã ấn **Confirm** xác nhận uống thuốc.`)
        .addFields({name:'🌷 Chi tiết',value:`• **Giờ nhắc:** ${stamp(dose.scheduled_at)}\n• **Giờ xác nhận:** ${dose.taken_at?stamp(dose.taken_at):'—'}`})
        .setFooter({text:'🎀 Đã dừng nhắc lại cho lần uống này · Giờ Việt Nam'});
      const nonce=createHash('sha256').update(`admin:${dose.id}`).digest('hex').slice(0,24);
      await user.send({embeds:[embed],allowedMentions:{parse:[]},nonce,enforceNonce:true});
      await conn.query('UPDATE medication_doses SET admin_notified_at=now(),admin_notify_error=NULL WHERE id=$1',[dose.id]);
    }catch(err) {
      const code=typeof err==='object'&&err&&'code' in err?String(err.code):'delivery_unknown';
      await conn.query("UPDATE medication_doses SET admin_notify_attempts=admin_notify_attempts+1,admin_notify_due_at=now()+interval '30 seconds',admin_notify_error=$2 WHERE id=$1",[dose.id,code]);
      logger.warn({doseId:dose.id,code},'Admin medication confirmation DM will retry');
    }
    await conn.query('COMMIT');
  }catch(err){await conn.query('ROLLBACK');throw err;}finally{conn.release();}
}
export async function tick(client:Client, now=new Date(), testOnly=false) {
  if(!client.isReady())return;
  const conn=await pool.connect();
  let locked=false;
  try {
    locked=(await conn.query('SELECT pg_try_advisory_lock(72411611) AS locked')).rows[0].locked;
    if(!locked)return;
    if(!testOnly)await notifyAdmin(client);
    const s=await settings();
    await conn.query("UPDATE medication_doses SET status='unconfirmed' WHERE status='pending' AND closes_at<=now()");
    if(!s.enabled)return;
    const day=localDay(now), due=new Date(`${day}T21:00:00+07:00`);
    // Do not send a backlog of old reminders after downtime.
    if(!testOnly && now>=due && now.getTime()-due.getTime()<3600000) {
      await conn.query(`INSERT INTO medication_doses(user_id,day,scheduled_at,closes_at,title,description) VALUES($1,$2,$3,$3::timestamptz+interval '3 hours',$4,$5) ON CONFLICT DO NOTHING`,[OWNER,day,due,s.title,s.description]);
    }
    const rows=await conn.query<Dose>(`SELECT *,day::text FROM medication_doses WHERE status='pending' AND next_send_at<=now() AND closes_at>now() AND sends<$1 AND attempts<3 AND test=$2 ORDER BY next_send_at LIMIT 10`,[1+s.max_repeats,testOnly]);
    for(const dose of rows.rows) {
      // Lock the dose while sending so confirm/pause cannot overtake this send.
      await conn.query('BEGIN');
      try {
        const current=(await conn.query<Dose>("SELECT *,day::text FROM medication_doses WHERE id=$1 FOR UPDATE",[dose.id])).rows[0];
        const enabled=(await conn.query('SELECT enabled FROM medication_settings WHERE id=1')).rows[0].enabled;
        if(current.status!=='pending'||!enabled){await conn.query('COMMIT');continue;}
        // Persist an attempt before network I/O. Never resend ambiguous delivery beyond nonce window.
        if(current.attempts>0) {
          await conn.query("UPDATE medication_doses SET last_error='delivery_unknown',attempts=3 WHERE id=$1",[dose.id]);
          await conn.query('COMMIT');continue;
        }
        await conn.query('COMMIT');
        await conn.query('UPDATE medication_doses SET attempts=1 WHERE id=$1',[dose.id]);
        await conn.query('BEGIN');
        const again=(await conn.query<Dose>('SELECT *,day::text FROM medication_doses WHERE id=$1 FOR UPDATE',[dose.id])).rows[0];
        const active=(await conn.query('SELECT enabled FROM medication_settings WHERE id=1')).rows[0].enabled;
        if(again.status!=='pending'||!active){await conn.query('UPDATE medication_doses SET attempts=0 WHERE id=$1',[dose.id]);await conn.query('COMMIT');continue;}
        const user=await client.users.fetch(dose.user_id);
        const nonce=createHash('sha256').update(`${dose.id}:${dose.sends}`).digest('hex').slice(0,24);
        const msg=await user.send({...doseMessage(again),nonce,enforceNonce:true});
        await conn.query("UPDATE medication_doses SET sends=sends+1,attempts=0,last_error=NULL,message_id=$2,channel_id=$3,next_send_at=now()+interval '15 minutes' WHERE id=$1",[dose.id,msg.id,msg.channelId]);
        await conn.query('COMMIT');
      } catch(err) {
        await conn.query('ROLLBACK');
        const code=typeof err==='object'&&err&&'code' in err?String(err.code):'delivery_unknown';
        await conn.query('UPDATE medication_doses SET attempts=3,last_error=$2 WHERE id=$1',[dose.id,code]);
        logger.warn({doseId:dose.id,code},'Medication delivery stopped; inspect admin panel');
      }
    }
  } finally { if(locked)await conn.query('SELECT pg_advisory_unlock(72411611)'); conn.release(); }
}
let timer:ReturnType<typeof setInterval>|undefined;
let inFlight:Promise<void>|undefined;
export function startMedication(client:Client, testOnly=false) {
  const run=()=>{if(inFlight)return;inFlight=tick(client,new Date(),testOnly).catch(()=>logger.error('Medication scheduler failed')).finally(()=>{inFlight=undefined;});};
  if(timer)return;
  timer=setInterval(run,30000);run();
}
export async function stopMedication(){if(timer)clearInterval(timer);timer=undefined;await inFlight;}
