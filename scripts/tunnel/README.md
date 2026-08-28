# Автозапуск SSH-туннеля

Туннель нужен, когда бэкенд стоит на сервере, а порт на нём закрыт снаружи (так по умолчанию). Расширение обращается к `localhost`, трафик идёт по ssh, конспект считает сервер.

Скрипты переподключаются сами: если связь оборвалась, ssh выходит и запускается снова через 10 секунд.

## Windows

1. Откройте `windows/conspect-tunnel.cmd` и впишите `SERVER` (и `PORT`, если меняли).
2. Проверьте вручную: запустите файл двойным щелчком, затем в другом окне `curl http://localhost:3000/health`.
3. Автозапуск: впишите путь к `.cmd` в `windows/conspect-tunnel.vbs`, нажмите Win+R, введите `shell:startup` и скопируйте `.vbs` в открывшуюся папку.

Прав администратора не требуется. Планировщик заданий тоже подошёл бы, но он их требует.

## Linux

```bash
mkdir -p ~/.config/systemd/user
cp linux/conspect-tunnel.service ~/.config/systemd/user/
# впишите адрес сервера в ExecStart
nano ~/.config/systemd/user/conspect-tunnel.service

systemctl --user daemon-reload
systemctl --user enable --now conspect-tunnel
systemctl --user status conspect-tunnel
```

Чтобы туннель работал и без активной сессии: `sudo loginctl enable-linger $USER`.

## macOS

Готового файла нет, проще всего через `autossh`:

```bash
brew install autossh
autossh -M 0 -f -N -T -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 3000:localhost:3000 user@your-server
```

Для автозапуска оберните эту команду в launchd-агент (`~/Library/LaunchAgents`).

## Вход по ключу

Скрипты не умеют вводить пароль. Настройте ключ заранее:

```bash
ssh-keygen -t ed25519
ssh-copy-id user@your-server
```

## Проверка

```bash
curl http://localhost:3000/health
# {"ok":true,"version":"1"}
```

Если ответа нет: посмотрите, запущен ли процесс `ssh`, не занят ли порт другим приложением (`ExitOnForwardFailure` заставляет ssh выйти в этом случае) и отвечает ли бэкенд на самом сервере.
