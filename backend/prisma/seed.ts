import { closePrisma, prisma } from '../dist/db/prisma.js';

const developmentUser = {
  email: 'dev@reachinbox.local',
  name: 'Development User',
};

const developmentSender = {
  email: 'sender@ethereal.email',
  displayName: 'Development Sender',
};

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: developmentUser.email },
    update: {
      name: developmentUser.name,
      googleId: null,
    },
    create: {
      email: developmentUser.email,
      name: developmentUser.name,
      googleId: null,
    },
  });

  const existingSender = await prisma.sender.findFirst({
    where: {
      userId: user.id,
      email: developmentSender.email,
    },
  });

  const sender = existingSender
    ? await prisma.sender.update({
        where: { id: existingSender.id },
        data: { displayName: developmentSender.displayName },
      })
    : await prisma.sender.create({
        data: {
          userId: user.id,
          email: developmentSender.email,
          displayName: developmentSender.displayName,
        },
      });

  console.log(
    JSON.stringify(
      {
        user: { id: user.id, email: user.email },
        sender: { id: sender.id, email: sender.email },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrisma();
  });
