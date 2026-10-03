# AR1C OFFICIAL BOT

Bot de Discord para un servidor competitivo de 1v1 por clanes. Cada clan tiene capitan, 3 starters y 1 sub. El bot esta en ingles, sin emojis.

## Como se guardan los datos (importante)

Todo se guarda en una base de datos PostgreSQL de Railway, que es un servicio aparte del bot.

- Si borras el servicio del bot, lo vuelves a crear o haces redeploy, los datos siguen ahi.
- Si sacas el bot del servidor de Discord y lo vuelves a meter, los datos siguen ahi (se guardan por ID del servidor).
- Lo unico que borra los datos es borrar el servicio de Postgres o su volumen. No lo borres.
- Al arrancar, el bot solo CREA tablas si faltan. Nunca borra ni modifica datos existentes.
- Extra: `/admin backup` te manda un archivo JSON con todo, y `/admin restore` lo recupera. Descargalo de vez en cuando.

## Setup

### 1. Crear la app en Discord
1. Ve a https://discord.com/developers/applications y crea una aplicacion.
2. En **Bot**: copia el token (`DISCORD_TOKEN`) y activa **Server Members Intent**.
3. En **General Information** copia el Application ID (`CLIENT_ID`).
4. En **OAuth2 > URL Generator** marca `bot` y `applications.commands`. Permisos: Manage Roles, View Channels, Send Messages, Embed Links. Abre la URL y agrega el bot a tu servidor.
5. En el servidor, sube el rol del bot por encima de los roles de clan (los roles de clan los crea el bot, asi que normalmente ya quedan debajo).

### 2. Subir a GitHub
```
git init
git add .
git commit -m "AR1C bot"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```
El archivo `.env` esta en `.gitignore`, nunca subas tu token.

### 3. Railway
1. New Project > Deploy from GitHub repo > elige el repo.
2. En el mismo proyecto: New > Database > Add PostgreSQL.
3. En el servicio del bot, pestana Variables:
   - `DISCORD_TOKEN` = tu token
   - `CLIENT_ID` = tu application ID
   - `GUILD_ID` = ID de tu servidor (opcional, hace que los comandos aparezcan al instante)
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (referencia al Postgres; si tu servicio de Postgres tiene otro nombre, usa ese)
4. Deploy. En los logs debe salir "Connected to the database", "Registered 6 commands" y "Logged in as ...".

### 4. Configurar en el servidor
1. `/admin set-transactions-channel` y elige el canal donde se anuncian los movimientos de roster.
2. `/admin set-matches-channel` y elige el canal donde se anuncian las peleas entre clanes. Si no lo configuras, el bot anuncia en el canal donde el capitan uso el comando.
3. `/admin create-clan` para crear cada clan oficial (nombre, color, capitan).
4. Si ya tenias clanes creados antes de esta version, corre `/admin sync-captains` una vez para darle el rol de capitan a los capitanes que ya existen.

## Comandos

Todos
- `/clans` lista todos los clanes y rosters
- `/roster view [clan]` muestra un roster
- `/match status [clan]` muestra el match actual o el ultimo de un clan (en curso o ya terminado)
- `/match live` muestra todos los matches en curso y quien se esta enfrentando a quien
- `/clan leave` salir de tu clan
- `/commands` lista de comandos

Capitanes
- `/roster add user [slot]` agregar jugador
- `/roster remove user` quitar jugador
- `/roster move user slot` mover de slot (si el slot esta ocupado, se intercambian; asi el sub entra por un starter)
- `/clan captain user` pasar el capitan a alguien del roster
- `/match start opponent [games]` anunciar una pelea contra otro clan
- `/match fight player versus` anunciar quien se enfrenta a quien en el siguiente game (uno de cada clan, en cualquier orden)
- `/match result winner` anunciar quien gano el game actual (el bot lleva el marcador)
- `/match undo` borrar el ultimo game si hubo un error
- `/match end` terminar el match y anunciar el resultado final
- `/match cancel` cancelar el match sin resultado
- `/match announce text` mandar un aviso corto sobre el match (por ejemplo "siguiente ronda en 5 minutos")

Admins (permiso Manage Server)
- `/admin create-clan name color captain`
- `/admin delete-clan name confirm`
- `/admin set-transactions-channel channel`
- `/admin set-matches-channel channel`
- `/admin set-captain user clan` hace capitan a alguien. Se guarda su ID en la base de datos, se le da el rol Captain y puede usar los comandos de capitan. Si no esta en el roster, lo agrega en el primer slot libre. El capitan anterior se queda en el roster como miembro normal y pierde el rol.
- `/admin remove-captain clan` le quita el capitan al clan (la persona se queda en el roster)
- `/admin set-captain-role role` elige un rol que ya tengas como rol de capitan (si no lo configuras, el bot crea uno llamado Captain la primera vez)
- `/admin sync-captains` le da el rol de capitan a todos los capitanes actuales
- `/admin history [amount]`
- `/admin backup`
- `/admin restore file confirm`
- Los admins pueden usar la opcion `clan` en los comandos de capitan para actuar sobre cualquier clan.

Como funcionan las peleas: cualquiera de los dos capitanes puede manejar el match. Solo puede haber un match en curso por clan y un game en vivo a la vez. Para `/match end` tiene que haber al menos un game terminado; el ganador sale del marcador (o queda empate). Los matches y sus games nunca se borran: quedan guardados en la base de datos aunque se borre un clan (si borras un clan, su match en curso se cancela). `/admin backup` tambien exporta los matches, y `/admin restore` los recupera si la base esta vacia.

Quien es capitan: el bot lo saca de la base de datos (el ID guardado en cada clan), no del rol de Discord. El rol Captain es solo una etiqueta visual. Si le das el rol a mano a alguien en Discord, NO funciona: tiene que ser con `/admin set-captain` o con `/clan captain` (el capitan actual se lo pasa a alguien de su roster). El rol se pone y se quita solo en cada cambio de capitan.

Reglas: una persona solo puede estar en un clan. El capitan no se puede quitar ni salir hasta pasar el capitan a otro. Cada movimiento (agregar, quitar, mover, salir, capitan, crear/borrar clan) se anuncia en el canal de transacciones y queda guardado en el historial.

## Correr local
```
cp .env.example .env   # llena los valores
npm install
npm run dev
```
Necesitas un Postgres local o la URL publica de Railway (con `DATABASE_SSL=true`).
