# 免费远程访问：Cloudflare Quick Tunnel

Cloudflare Worker 直连 Danbooru 容易被其机房出口 IP 拦截，所以 DFlow 不再提供 Worker 版本。免费远程访问可以改用“家中电脑运行 DFlow + Cloudflare Quick Tunnel”。

此方式中，Danbooru 请求仍由运行 DFlow 的电脑发出；手机只通过临时公网地址访问本地页面。电脑和隧道进程必须保持运行。

## 1. 启动 DFlow

```powershell
Set-Location 'D:\commen\agentsland\dflow'
.\start.bat
```

先确认电脑可以打开：

```text
http://127.0.0.1:4173
```

## 2. 准备 cloudflared

下载 Windows 版 `cloudflared.exe`，放到例如：

```text
C:\Tools\cloudflared\cloudflared.exe
```

## 3. 建立临时公网地址

另开一个 PowerShell 窗口执行：

```powershell
C:\Tools\cloudflared\cloudflared.exe tunnel --url http://127.0.0.1:4173
```

终端会给出类似下面的临时地址：

```text
https://xxxx-xxxx.trycloudflare.com
```

手机访问该地址即可。每次重启隧道后地址可能改变。

## 局域网内直接访问

手机与电脑连接同一局域网时，不需要隧道。先运行：

```powershell
ipconfig
```

找到电脑当前的 IPv4 地址，例如 `192.168.1.23`，手机访问：

```text
http://192.168.1.23:4173
```

如果打不开，检查 Windows 防火墙是否允许 Node.js 使用专用网络。
