# Mail Stack Deploy

[English](README.md) | 简体中文

这是一个用于在远程 Linux 服务器上部署自建邮件服务栈的 Ansible 项目。

服务栈包含：

- [Stalwart Mail Server](https://stalw.art/)：SMTP、IMAP、POP3、JMAP、DKIM 和域名管理
- [Roundcube](https://roundcube.net/)：网页邮箱客户端
- React + Ant Design 管理工具：
  - 批量创建邮箱账号
  - 自动跳过已存在账号，避免重复创建
  - 按邮箱账号查看收件箱
  - 邮件内容预览
- Nginx 反向代理
- Certbot 自动申请 Let's Encrypt HTTPS 证书

## 架构

```text
Internet
  |
  | 25 / 465 / 587 / 993
  v
Stalwart Mail Server

Browser
  |
  | HTTPS
  v
Nginx
  |-- /admin/  -> Stalwart Web Admin
  |-- /tools/  -> Mail Tools
  '-- webmail -> Roundcube
```

默认公网入口：

```text
Stalwart Admin: https://mail.example.com/admin/
Mail Tools:     https://mail.example.com/tools/
Roundcube:      https://webmail.example.com/
```

## 部署前准备

运行 Playbook 前需要准备：

1. 一台可以 root SSH 登录的 Linux 服务器。
2. 一个公网 IPv4 地址。
3. 一个你可以管理 DNS 的域名或子域名。
4. 配好 `mail_host`、`webmail_host`、MX、SPF、DMARC 等 DNS 记录。
5. 在云服务器安全组或防火墙中开放必要端口。
6. 服务器上没有其他邮件服务占用 SMTP、IMAP、POP3、ManageSieve 标准端口。
7. 一台安装了 `ansible` 和 `ssh` 的控制机。

域名不一定要是子域名。下面两种都可以：

```text
domain: example.com
mail_host: mail.example.com
webmail_host: webmail.example.com
```

```text
domain: edu.example.com
mail_host: mail.edu.example.com
webmail_host: webmail.edu.example.com
```

## 服务器要求

目标服务器：

- Linux 服务器，支持 root SSH 登录
- 支持的系统：
  - RHEL 系：OpenCloudOS、CentOS、Rocky Linux、AlmaLinux
  - Debian 系：Debian、Ubuntu
- 内存至少 2 GB，建议 4 GB 或更高
- 磁盘建议 30 GB 或更高
- 服务器上不能已有邮件服务监听 SMTP/IMAP 端口
- 需要公网 IPv4

云安全组或防火墙必须开放：

```text
25, 80, 443, 465, 587, 993
```

建议同时开放：

```text
110, 143, 995, 4190
```

`25` 入站端口是收信必须的。即使只收信也要开放 `25`。如果云厂商封了出站 `25`，收信仍然可以工作，但对外发信会受影响。

### 端口处理

邮件协议端口是固定端口，必须在服务器上可用：

```text
25, 465, 587, 993
```

Playbook 还会检查常见可选邮件端口：

```text
110, 143, 995, 4190
```

这些端口属于标准 SMTP、IMAP、POP3 和 ManageSieve 行为，Playbook 不会把它们自动改成随机端口。

Web 服务不同。Stalwart Admin、Roundcube 和 Mail Tools 会先绑定到 `127.0.0.1` 的本地端口，再由反向代理对外提供 HTTPS。如果某个本地 Web upstream 端口被占用，Playbook 可以自动从配置范围里选择空闲端口。

默认配置：

```yaml
web_proxy_mode: auto
auto_select_local_ports: true
local_port_range_start: 18080
local_port_range_end: 18199
```

`web_proxy_mode` 支持：

- `auto`：如果 `80/443` 空闲或已经由 Nginx 管理，则使用内置 Nginx；如果被其他服务占用，则自动切换到外部反向代理模式。
- `managed`：由本 Playbook 安装和管理 Nginx、Certbot，并直接使用 `80/443`。
- `external`：不管理公网 Nginx 站点，只生成给已有反向代理使用的 upstream 信息。

如果新服务器的 `80/443` 已经被其他网站或面板占用，保持默认：

```yaml
web_proxy_mode: auto
```

或者显式设置：

```yaml
web_proxy_mode: external
```

部署完成后会生成：

```text
/opt/mail-stack/external-proxy-upstreams.txt
```

把这个文件里的 upstream 信息接入已有 Nginx、Caddy、1Panel、宝塔面板或其他反向代理即可。

## DNS 要求

邮件相关 DNS 记录必须是 DNS only。使用 Cloudflare 时，请关闭代理，保持灰云。

以 `example.com` 为例：

```text
A     mail.example.com       SERVER_IP
A     webmail.example.com    SERVER_IP
MX    example.com            10 mail.example.com
TXT   example.com            v=spf1 mx -all
TXT   _dmarc.example.com     v=DMARC1; p=reject; rua=mailto:postmaster@example.com
```

DKIM 记录会在 Stalwart 初始化后生成，Playbook 会写入：

```text
/opt/mail-stack/dns-records.txt
```

## 控制机要求

从任意可以 SSH 到目标服务器的机器运行 Ansible。

本地需要：

```text
ansible
ssh
```

不需要额外安装 Ansible Galaxy collection。

## 配置

编辑 `inventory.yml`：

```yaml
mail_servers:
  hosts:
    mail01:
      ansible_host: 1.2.3.4
      ansible_user: root
```

编辑 `group_vars/all.yml`：

```yaml
domain: example.com
mail_host: mail.example.com
webmail_host: webmail.example.com
admin_email: admin@example.com
```

可选密码可以留空：

```yaml
bootstrap_recovery_password: ""
stalwart_admin_password: ""
tools_admin_password: ""
mail_tools_session_secret: ""
```

留空时，Playbook 会自动生成稳定密钥并保存到：

```text
.secrets/<inventory-host>/
```

不要把 `.secrets/` 提交到 GitHub。

可选端口配置：

```yaml
web_proxy_mode: auto
auto_select_local_ports: true
local_port_range_start: 18080
local_port_range_end: 18199

stalwart_http_port: 8088
stalwart_https_port: 8443
roundcube_http_port: 8089
tools_port: 8091
```

上面四个服务端口是优先使用的本地端口。如果端口被占用，并且 `auto_select_local_ports` 开启，Playbook 会自动从端口范围里选择空闲端口。

## 部署

使用 SSH key 登录：

```bash
ansible-playbook deploy.yml
```

使用 SSH 密码登录：

```bash
ansible-playbook deploy.yml --ask-pass
```

部署流程：

1. 安装系统依赖
2. 检测公网 Web 端口
3. 选择本地 upstream 端口
4. 安装和启动 Docker
5. 在 `web_proxy_mode` 为 managed 时安装 Nginx 和 Certbot
6. 初始化 Stalwart
7. 部署 Roundcube
8. 构建并部署 Mail Tools
9. 配置 Nginx 反向代理或生成外部反代 upstream 说明
10. 在内置 Nginx 模式下申请 Let's Encrypt 证书
11. 执行健康检查
12. 导出 DNS 记录

## 服务器上生成的文件

```text
/opt/mail-stack/.env
/opt/mail-stack/credentials.txt
/opt/mail-stack/dns-records.txt
/opt/mail-stack/compose.yml
/opt/mail-stack/external-proxy-upstreams.txt
/opt/mail-stack/scripts/
```

查看账号密码：

```bash
cat /opt/mail-stack/credentials.txt
```

查看 DNS 记录：

```bash
cat /opt/mail-stack/dns-records.txt
```

## 运维命令

健康检查：

```bash
ansible-playbook health.yml
```

打印 DNS 记录：

```bash
ansible-playbook dns.yml
```

重启服务：

```bash
ansible-playbook restart.yml
```

创建备份：

```bash
ansible-playbook backup.yml
```

备份文件会保存到：

```text
/opt/mail-stack/backups/
```

## 注意事项

- 邮件相关 DNS 记录不要走 Cloudflare 代理，必须灰云。
- 不要公开或提交 `.secrets/`。
- 部署后检查 `/opt/mail-stack/dns-records.txt`，把生成的 DKIM 记录添加到 DNS。
- 如果需要稳定对外发信，建议配置服务器 IP 的反向 DNS/PTR。
