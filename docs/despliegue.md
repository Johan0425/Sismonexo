# Despliegue

## Vercel (producción)

- Proyecto: `sismonexo-colombia` · URL: https://sismonexo-colombia.vercel.app
- Repositorio conectado: `Johan0425/proyecto-an-lisis-datos` (integración de Git de Vercel).
- **Cada `git push` a `main` despliega producción.** Cada rama o pull request genera una URL de vista previa.

Qué hace Vercel en cada despliegue (definido en `vercel.json`):

| Paso | Comando |
|---|---|
| Instalar | `npm --prefix web ci` |
| Compilar | `npm --prefix web run build` (comprueba tipos con `tsc` y compila con Vite) |
| Publicar | carpeta `web/dist` |

El `package.json` de la raíz fija la versión de Node (22.12 o superior). Los datos reales viajan dentro del sitio (`web/public/data`, ≈ 37 MB), de modo que no hay backend que desplegar.

### Comprobar un despliegue

```bash
vercel ls sismonexo-colombia          # últimos despliegues y su estado
vercel inspect <url> --logs           # registro de compilación
curl -sI https://sismonexo-colombia.vercel.app/data/index.json   # debe responder 200
```

### Si un push no despliega

1. Confirme que el repositorio sigue conectado: `vercel git connect` desde la raíz.
2. Revise que `web/package-lock.json` esté actualizado (`npm --prefix web ci` falla si no coincide con `package.json`).
3. Ejecute localmente lo mismo que Vercel: `vercel build --prod`.
4. No añada `data` sin barra inicial a `.vercelignore`: excluiría también `web/public/data` y la aplicación quedaría sin datos. Las rutas de ese archivo están ancladas a la raíz (`/data`).

### Actualizar los datos publicados

Ejecute el pipeline (ver README), confirme los cambios de `web/public/data` y haga push. El despliegue publica los nuevos artefactos.

## Docker (alternativa autoalojada)

`docker compose up --build` levanta Nginx con el sitio compilado (puerto 8080) y la API (puerto 8000). Con `--profile db` se añade PostgreSQL/PostGIS. Ver README.

## Otros hospedajes estáticos

El compilado usa rutas relativas y enrutamiento por `#`, así que `web/dist` funciona en GitHub Pages, un servidor institucional o cualquier subcarpeta sin configuración adicional.
