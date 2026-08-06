-- CreateTable
CREATE TABLE "MercadoPagoCuenta" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "venceEn" TIMESTAMP(3) NOT NULL,
    "mpUserId" TEXT NOT NULL,
    "apodo" TEXT NOT NULL DEFAULT '',
    "caida" BOOLEAN NOT NULL DEFAULT false,
    "vinculadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoPagoCuenta_pkey" PRIMARY KEY ("id")
);
