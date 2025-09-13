import 'dotenv/config';
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

// 0) Сброс вебхука, чтобы polling точно работал
await bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(() => {});

// 1) Кто мы
const me = await bot.telegram.getMe();
console.log('Running as @' + me.username);

// 2) Целевая группа: из .env (может быть пусто — тогда привяжем через /setgroup)
let TARGET_GROUP_ID = process.env.GROUP_ID || null;

// ---- Утилиты
function formatSender(from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  const uname = from.username ? ` @${from.username}` : '';
  return `${name || 'Без имени'}${uname} (id:${from.id})`;
}
function formatTime(ctx) {
  const d = new Date((ctx.message?.date ?? Math.floor(Date.now()/1000)) * 1000);
  return d.toLocaleString('ru-RU');
}
function makeHeader(ctx) {
  return `📝 Сообщение от: ${formatSender(ctx.from)}\n🕒 Время: ${formatTime(ctx)}`;
}

// ---- Команды (ставим выше любых on('message'))
bot.command('ping', (ctx) => ctx.reply('pong'));
bot.command('id', (ctx) => ctx.reply(`chat.id = ${ctx.chat.id}`));

bot.command('setgroup', async (ctx) => {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) {
    return ctx.reply('Эту команду нужно отправить в НУЖНОЙ ГРУППЕ.');
  }
  TARGET_GROUP_ID = String(ctx.chat.id);

  // Проверим, что бот реально состоит в этой группе и может писать
  const member = await bot.telegram.getChatMember(TARGET_GROUP_ID, me.id).catch(() => null);
  if (!member || ['left','kicked'].includes(member.status)) {
    return ctx.reply('Я не состою в группе. Добавь меня (лучше админом) и повтори /setgroup.');
  }
  if (member.status === 'restricted') {
    return ctx.reply('У меня нет прав писать. Дай право отправлять сообщения/медиа и повтори /setgroup.');
  }

  await ctx.reply(`Группа установлена: ${TARGET_GROUP_ID} ✅`);
  console.log('Bound group to', TARGET_GROUP_ID);
});

// ---- Глобальный логгер апдейтов (видно, приходит ли что-то из группы)
bot.use((ctx, next) => {
  console.log('update:', {
    type: ctx.updateType,
    chatType: ctx.chat?.type,
    chatId: ctx.chat?.id,
    text: ctx.message?.text
  });
  return next();
});

// ---- Лог id группы при любом сообщении из неё (ещё один способ узнать id)
bot.on('message', (ctx, next) => {
  if (['group','supergroup'].includes(ctx.chat?.type)) {
    console.log('Группа: ctx.chat.id =', ctx.chat.id);
  }
  return next();
});

// ---- Главная логика: ЛС → в группу
bot.on('message', async (ctx) => {
  try {
    // работаем только с личкой
    if (ctx.chat?.type !== 'private') return;

    if (!TARGET_GROUP_ID) {
      return ctx.reply(`Группа ещё не привязана. Зайди в нужную группу и пришли /setgroup`);
    }

    // убеждаемся, что бот там есть и может писать
    const member = await bot.telegram.getChatMember(TARGET_GROUP_ID, me.id).catch(() => null);
    if (!member || ['left','kicked'].includes(member.status)) {
      return ctx.reply('Я не состою в группе. Добавь меня (лучше админом) и пришли /setgroup в группе.');
    }
    if (member.status === 'restricted') {
      return ctx.reply('У меня нет прав писать в группе. Дай права и повтори /setgroup.');
    }

    const header = makeHeader(ctx);

    if (ctx.message.text) {
      await ctx.telegram.sendMessage(TARGET_GROUP_ID, `${header}\n\n${ctx.message.text}`, {
        disable_web_page_preview: true
      });
      return ctx.reply('Отправил в группу ✅');
    }

    await ctx.telegram.sendMessage(TARGET_GROUP_ID, header);
    await ctx.telegram.copyMessage(TARGET_GROUP_ID, ctx.chat.id, ctx.message.message_id);
    await ctx.reply('Отправил в группу ✅');
  } catch (err) {
    console.error('TG error:', {
      code: err.response?.error_code,
      desc: err.response?.description
    });
    await ctx.reply('Не смог отправить в группу. Проверь, что я в группе и что /setgroup выполнен в нужной группе.');
  }
});

// ---- Запуск
await bot.launch();
console.log('Bot started.');

// ---- Корректное завершение
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
