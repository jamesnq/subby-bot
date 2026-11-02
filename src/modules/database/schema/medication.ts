import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, bigserial } from 'drizzle-orm/pg-core';
export const medicationSettings=pgTable('medication_settings',{
 id:integer('id').primaryKey(),enabled:boolean('enabled').notNull().default(true),
 title:text('title').notNull().default('Mthi thúi đến giờ uống thuốc !!!'),description:text('description').notNull().default('Em thúi uống thuốc xong ấn confirm cho tôy nhé'),
 maxRepeats:integer('max_repeats').notNull().default(2),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
export const medicationDoses=pgTable('medication_doses',{
 id:uuid('id').primaryKey().defaultRandom(),userId:text('user_id').notNull(),day:date('day').notNull(),test:boolean('test').notNull().default(false),
 scheduledAt:timestamp('scheduled_at',{withTimezone:true}).notNull(),closesAt:timestamp('closes_at',{withTimezone:true}).notNull(),
 title:text('title').notNull(),description:text('description').notNull(),status:text('status').notNull().default('pending'),
 takenAt:timestamp('taken_at',{withTimezone:true}),nextSendAt:timestamp('next_send_at',{withTimezone:true}).notNull().defaultNow(),
 adminNotifiedAt:timestamp('admin_notified_at',{withTimezone:true}),adminNotifyAttempts:integer('admin_notify_attempts').notNull().default(0),adminNotifyDueAt:timestamp('admin_notify_due_at',{withTimezone:true}),adminNotifyError:text('admin_notify_error'),
 sends:integer('sends').notNull().default(0),attempts:integer('attempts').notNull().default(0),lastError:text('last_error'),messageId:text('message_id'),channelId:text('channel_id'),
},t=>[uniqueIndex('medication_doses_user_id_day_test_key').on(t.userId,t.day,t.test),index('medication_history_idx').on(t.userId,t.test,t.day)]);
export const medicationAudit=pgTable('medication_audit',{
 id:bigserial('id',{mode:'number'}).primaryKey(),actorId:text('actor_id').notNull(),action:text('action').notNull(),doseId:uuid('dose_id').references(()=>medicationDoses.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
