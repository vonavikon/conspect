@echo off
rem Постоянный SSH-туннель к серверу Conspect для Windows.
rem Пробрасывает порт бэкенда на этот компьютер: расширение обращается к localhost,
rem конспект считает сервер. Наружу на сервере ничего открывать не нужно.
rem
rem Перед первым запуском:
rem   1. Впишите ниже адрес сервера (и порт, если меняли).
rem   2. Настройте вход по ключу, чтобы ssh не спрашивал пароль:
rem      ssh-keygen -t ed25519  и  ssh-copy-id user@your-server
rem      (либо добавьте Host-алиас в %USERPROFILE%\.ssh\config и укажите его в SERVER)
rem
rem Автозапуск при входе в Windows: см. conspect-tunnel.vbs рядом.

set SERVER=user@your-server
set PORT=3000

rem ExitOnForwardFailure — не висеть молча, если порт уже занят.
rem ServerAlive* — заметить обрыв связи за ~90 секунд, а не ждать TCP-таймаут.
:loop
ssh -N -T -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L %PORT%:localhost:%PORT% %SERVER%
timeout /t 10 /nobreak >nul
goto loop
