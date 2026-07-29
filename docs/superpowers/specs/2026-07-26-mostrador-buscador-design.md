# Buscador en el mostrador (reemplaza la botonera) — Diseño

**Fecha:** 2026-07-26
**Objetivo:** Cambiar el diseño del mostrador: eliminar la grilla de botones grandes (botonera) y
reemplazarla por un **buscador** de productos. El operador escribe el nombre, ve la lista filtrada
en pantalla y toca un producto para agregarlo al carrito. El escáner sigue funcionando como vía
rápida.

## Decisiones tomadas

- **Alcance:** el buscador busca sobre **todos los productos activos** (no solo los `enBotonera`).
- **Filtrado:** lista **precargada** al abrir el mostrador; filtra en el cliente mientras se
  escribe (sin ir al backend por cada tecla). Catálogo de buffet = decenas de productos.
- **Match:** por nombre, insensible a mayúsculas y acentos.
- **Buscador vacío:** muestra todos los activos (lista navegable).
- **Al agregar:** el texto del buscador **se mantiene** (permite agregar varios rápido).
- **Escáner:** sin cambios; sigue resolviendo por código y agregando al carrito.
- **Carrito y pantalla de cobro:** sin cambios.

## Backend

- Nuevo endpoint `GET /buffet/productos/activos` (`authBuffet`) → todos los productos con
  `activo: true`, como `{ id, nombre, precio }[]`, ordenados por `nombre` asc.
- Implementado en `buffetProductoService` (método `listActivos`), reusando el patrón de
  `listBotonera`/`porCodigo`.

## Frontend (mostrador)

- `frontend/src/app/mostrador/page.tsx`: cargar `/buffet/productos/activos` en vez de
  `/buffet/productos/botonera`, y pasarlo a `PantallaVenta` como `productos` (`ProductoCobro[]`).
- `frontend/src/components/mostrador/pantalla-venta.tsx`:
  - Cambiar la prop `botonera: ProductoBuffet[]` por `productos: ProductoCobro[]`.
  - **Eliminar** la `<section>` de la grilla de botones grandes.
  - Agregar un **input de búsqueda** (estado `query`) y, debajo, la lista de productos filtrada
    por `filtrarProductos(productos, query)`; cada ítem es un botón tocable (nombre + precio) que
    llama a `agregar(...)` (la función de carrito que ya existe).
  - Función pura exportada `filtrarProductos(productos, query)`: normaliza query y nombres
    (minúsculas + sin diacríticos) y devuelve los que incluyen el término; con query vacío
    devuelve todos.
  - El input de búsqueda NO debe robarle el foco al lector de código de forma permanente: al
    tocar/escribir en el buscador el foco va ahí; el mecanismo de recuperación de foco del lector
    se mantiene, pero no debe pelear con el input del buscador mientras está enfocado.

## Testing

- **Backend (integración, testcontainers):** `GET /buffet/productos/activos` devuelve solo
  activos, ordenados por nombre, con `{id,nombre,precio}`.
- **Frontend:** test unitario de `filtrarProductos` (match por nombre, insensible a
  mayúsculas/acentos, query vacío = todos) + `npm run build`.

## Criterios de éxito

1. El mostrador ya no muestra la grilla de botones grandes.
2. Escribir en el buscador filtra la lista en el acto; tocar un producto lo agrega al carrito.
3. El buscador encuentra cualquier producto activo por nombre (con o sin acentos/mayúsculas).
4. El escáner y el flujo de cobro siguen funcionando igual.

## Fuera de alcance (YAGNI)

- Eliminar el flag `enBotonera` y su endpoint/columna (quedan; el mostrador deja de usar la
  botonera).
- Búsqueda por código de barra en el input de texto (el escáner ya cubre el código).
- Búsqueda en el backend con debounce (no hace falta para este catálogo).
- Mostrar stock en los resultados.
