' Запускает conspect-tunnel.cmd без окна консоли.
'
' Автозапуск при входе в Windows (прав администратора не требует):
'   1. Впишите ниже полный путь к conspect-tunnel.cmd.
'   2. Нажмите Win+R, введите  shell:startup  и Enter.
'   3. Скопируйте этот .vbs в открывшуюся папку.
'
' Проверить, что туннель поднялся:  curl http://localhost:3000/health
' Остановить: снять процесс ssh.exe в диспетчере задач (или удалить файл из Startup
' и перезайти в систему).

TUNNEL_CMD = "C:\путь\к\conspect\scripts\tunnel\windows\conspect-tunnel.cmd"

CreateObject("WScript.Shell").Run "cmd /c """ & TUNNEL_CMD & """", 0, False
