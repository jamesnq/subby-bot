/** Local interactive test runner. Uses only test doses; does not start the daily worker. */
import 'dotenv/config';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { config } from '../src/config';
import { initMedication, sendTest, startMedication, stopMedication } from '../src/modules/medication/service';
import { handleMedication, medicationCommand } from '../src/modules/medication/interactions';
import { pool } from '../src/infrastructure/database/pool';
async function main() {
  await initMedication();
  const client=new Client({intents:[GatewayIntentBits.Guilds]});
  const rest=new REST().setToken(config.DISCORD_TOKEN);
  await rest.post(Routes.applicationCommands(config.DISCORD_CLIENT_ID),{body:medicationCommand.toJSON()});
  client.on(Events.InteractionCreate,i=>{void handleMedication(i,client).catch(async()=>{
    console.error('Medication test interaction failed');
    if(i.isRepliable()) {
      if(i.deferred||i.replied)await i.editReply('Chưa thể xử lý. Hãy thử lại.').catch(()=>{});
      else await i.reply({content:'Chưa thể xử lý. Hãy thử lại.',flags:64}).catch(()=>{});
    }
  });});
  client.once(Events.ClientReady,()=>{void sendTest(client).then(m=>{console.log('TEST_MESSAGE',m.url);startMedication(client,true);}).catch(()=>console.error('Test DM failed'));});
  await client.login(config.DISCORD_TOKEN);
  const stop=async()=>{await stopMedication();await client.destroy();await pool.end();process.exit(0);};
  process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
  console.log('Test handler active; daily scheduler OFF. Ctrl+C to stop.');
}
main().catch(()=>{console.error('Test runner failed: check DB/Discord configuration');process.exit(1);});
