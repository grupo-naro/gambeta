# reservas — Grupo Naro

Web pública para que los clientes de Grupo Naro reserven sus canchas de fútbol o pádel online.

## Correr en local

```bash
cp .env.example .env
# completar API_URL y SERVICE_API_KEY en .env
pnpm install
pnpm dev
```

Abrí [http://localhost:3000](http://localhost:3000).

## Variables de entorno

- `API_URL`: URL base del backend (el mismo que usa el panel de administración).
- `SERVICE_API_KEY`: llave de servicio del backend. Se usa solo en el server (nunca se expone al navegador).

## Deploy

Se despliega en [Vercel](https://vercel.com), configurando `API_URL` y `SERVICE_API_KEY` como variables de entorno del proyecto.
