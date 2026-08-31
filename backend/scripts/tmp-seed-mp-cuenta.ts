// Script TEMPORAL de verificación manual (Task 6, modal en dos pasos). No forma parte del
// entregable: inserta/borra una fila ficticia de MercadoPagoCuenta para poder ver, sin una
// cuenta de MP real vinculada, cómo se comporta el sitio cuando `cobrosOnline` es true.
// Se borra al terminar la verificación.
import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

const modo = process.argv[2];

async function main() {
  if (modo === 'crear') {
    await prisma.mercadoPagoCuenta.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        accessToken: 'FAKE-TEST-TOKEN',
        refreshToken: 'FAKE-TEST-REFRESH',
        venceEn: new Date(Date.now() + 3600_000),
        mpUserId: '000000',
        apodo: 'Cuenta de prueba (task 6)',
        caida: false,
      },
      update: { caida: false },
    });
    console.log('MercadoPagoCuenta ficticia creada');
  } else if (modo === 'borrar') {
    await prisma.mercadoPagoCuenta.deleteMany({ where: { id: 'default' } });
    console.log('MercadoPagoCuenta ficticia borrada');
  } else {
    console.log('uso: tsx tmp-seed-mp-cuenta.ts crear|borrar');
  }
  await prisma.$disconnect();
}
main();
