import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { Pool } from 'pg';
const mocks=vi.hoisted(()=>({pool:null as unknown as Pool}));
vi.mock('../src/infrastructure/database/pool',()=>({get pool(){return mocks.pool;}}));
import { initMedication,tick,history,notifyAdmin } from '../src/modules/medication/service';
import { handleMedication } from '../src/modules/medication/interactions';
import { OWNER,ADMIN,localDay } from '../src/modules/medication/ui';
const suite=process.env.MEDICATION_DB_TEST_URL?describe:describe.skip;
suite('medication persisted lifecycle',()=>{
 const schema='med_test_'+Date.now();let root:Pool;
 const send=vi.fn(async()=>({id:'message',channelId:'dm'}));
 const client={isReady:()=>true,users:{fetch:vi.fn(async()=>({send,createDM:async()=>({messages:{edit:vi.fn()}})}))}} as any;
 beforeAll(async()=>{root=new Pool({connectionString:process.env.MEDICATION_DB_TEST_URL});await root.query(`CREATE SCHEMA ${schema}`);mocks.pool=new Pool({connectionString:process.env.MEDICATION_DB_TEST_URL,options:`-c search_path=${schema}`});await initMedication();});
 afterAll(async()=>{await mocks.pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();});
 beforeEach(async()=>{await mocks.pool.query('TRUNCATE medication_audit,medication_doses');await mocks.pool.query('UPDATE medication_settings SET enabled=true,max_repeats=2');send.mockClear();});
 async function seed(user=OWNER,test=false){return (await mocks.pool.query(`INSERT INTO medication_doses(user_id,day,test,scheduled_at,closes_at,title,description) VALUES($1,$2,$3,now(),now()+interval '1 hour','Title','Description') RETURNING *`,[user,localDay(),test])).rows[0];}
 function interaction(id:string,user=OWNER,action='taken'){return {isChatInputCommand:()=>false,isButton:()=>true,isModalSubmit:()=>false,user:{id:user},customId:`med:${action}:${id}`,deferReply:vi.fn(),editReply:vi.fn()} as any;}
 it('sends once with two workers; only two repeats; confirmation stops all later sends',async()=>{
  const d=await seed();await Promise.all([tick(client),tick(client)]);expect(send).toHaveBeenCalledTimes(1);
  for(let n=0;n<4;n++){await mocks.pool.query("UPDATE medication_doses SET next_send_at=now()-interval '1 minute'");await tick(client);}
  expect(send).toHaveBeenCalledTimes(3);
  await handleMedication(interaction(d.id),client);await tick(client);expect(send).toHaveBeenCalledTimes(4);
  expect(client.users.fetch).toHaveBeenLastCalledWith(ADMIN);
  expect((await mocks.pool.query('SELECT admin_notified_at FROM medication_doses WHERE id=$1',[d.id])).rows[0].admin_notified_at).not.toBeNull();
  expect((await history(OWNER,false,30))[0].status).toBe('taken');
 });
 it('rejects another user and makes parallel confirmation idempotent',async()=>{
  const d=await seed();await handleMedication(interaction(d.id,ADMIN),client);
  expect((await history(OWNER,false,30))[0].status).toBe('pending');
  await Promise.all([handleMedication(interaction(d.id),client),handleMedication(interaction(d.id),client)]);
  expect((await mocks.pool.query('SELECT * FROM medication_audit')).rowCount).toBe(1);
 });
 it('snoozes without changing scheduled time or consuming another repeat',async()=>{
  const d=await seed();await handleMedication(interaction(d.id,OWNER,'snooze'),client);
  await tick(client);expect(send).not.toHaveBeenCalled();
  const row=(await mocks.pool.query('SELECT * FROM medication_doses')).rows[0];
  expect(row.scheduled_at).toEqual(d.scheduled_at);expect(row.next_send_at.getTime()-Date.now()).toBeGreaterThan(14*60000);
 });
 it('stops on blocked DM, keeps pending, separates test data, respects disabled setting',async()=>{
  await seed();await seed(ADMIN,true);send.mockRejectedValueOnce(Object.assign(new Error('blocked'),{code:50007}));
  await tick(client);const rows=await history(OWNER,false,30);expect(rows).toHaveLength(1);expect(rows[0].status).toBe('pending');expect(rows[0].last_error).toBe('50007');
  await mocks.pool.query('UPDATE medication_settings SET enabled=false');send.mockClear();await tick(client);expect(send).not.toHaveBeenCalled();
 });
 it('persists admin notification failure without reverting confirmation and retries once',async()=>{
  const d=await seed();send.mockRejectedValueOnce(new Error('temporary DM failure'));
  await handleMedication(interaction(d.id),client);
  let row=(await mocks.pool.query('SELECT * FROM medication_doses WHERE id=$1',[d.id])).rows[0];
  expect(row.status).toBe('taken');expect(row.admin_notify_attempts).toBe(1);expect(row.admin_notified_at).toBeNull();
  await mocks.pool.query("UPDATE medication_doses SET admin_notify_due_at=now()-interval '1 minute'");
  await notifyAdmin(client);await notifyAdmin(client);
  expect(send).toHaveBeenCalledTimes(2);
  row=(await mocks.pool.query('SELECT * FROM medication_doses WHERE id=$1',[d.id])).rows[0];expect(row.admin_notified_at).not.toBeNull();
 });
 it('never sends test doses to the real user or admin confirmation alerts for tests',async()=>{
  const d=await seed(ADMIN,true);await tick(client);expect(send).not.toHaveBeenCalled();
  await handleMedication(interaction(d.id,ADMIN),client);await notifyAdmin(client);expect(send).not.toHaveBeenCalled();
 });
 it('stops reminders at closing but records one late confirmation against the original dose',async()=>{
  const d=await seed();await mocks.pool.query("UPDATE medication_doses SET closes_at=now()-interval '1 minute'");await tick(client);
  expect((await history(OWNER,false,30))[0].status).toBe('unconfirmed');expect(send).not.toHaveBeenCalled();
  await Promise.all([handleMedication(interaction(d.id),client),handleMedication(interaction(d.id),client)]);
  const [dose]=await history(OWNER,false,30);
  expect(dose).toMatchObject({id:d.id,day:localDay(),status:'taken'});
  expect(dose.taken_at!.getTime()).toBeGreaterThan(dose.closes_at.getTime());
  expect(send).toHaveBeenCalledTimes(1);
  expect(client.users.fetch).toHaveBeenLastCalledWith(ADMIN);
 });
 it('rejects confirmation after the next scheduled dose begins',async()=>{
  const d=await seed();
  await mocks.pool.query("UPDATE medication_doses SET scheduled_at=now()-interval '24 hours',closes_at=now()-interval '21 hours',status='unconfirmed'");
  const click=interaction(d.id);
  await handleMedication(click,client);
  expect(click.editReply).toHaveBeenCalledWith('Đã hết thời gian xác nhận cho lượt này.');
  expect((await history(OWNER,false,30))[0].status).toBe('unconfirmed');expect(send).not.toHaveBeenCalled();
 });
 it('lets only the admin correct an existing real dose and audits the correction',async()=>{
  const d=await seed();
  const submit=(user:string)=>({
   ...interaction(d.id,user),isButton:()=>false,isModalSubmit:()=>true,customId:'med:save-history',
   fields:{getTextInputValue:(field:string)=>field==='day'?localDay():'1'},reply:vi.fn(),
  });
  await handleMedication(submit(OWNER),client);
  expect((await history(OWNER,false,30))[0].status).toBe('pending');
  await handleMedication(submit(ADMIN),client);
  expect((await history(OWNER,false,30))[0]).toMatchObject({status:'taken',taken_at:null});
  expect((await mocks.pool.query('SELECT actor_id,action,dose_id FROM medication_audit')).rows)
   .toEqual([{actor_id:ADMIN,action:'history:taken',dose_id:d.id}]);
  await notifyAdmin(client);expect(send).not.toHaveBeenCalled();
 });
});
