# Mail Stack Deploy

一套可重复部署的邮箱服务：

- Stalwart Mail Server
- Roundcube Webmail
- React + Ant Design 邮箱工具
  - 批量创建邮箱账号
  - 查看指定邮箱收件箱
  - 查看邮件正文

## 1. 本机准备

Mac:

```bash
brew install ansible
```

进入部署目录：

```bash
cd mail-stack-deploy
```

## 2. 改配置

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
domain: edu.example.com
mail_host: mail.edu.example.com
webmail_host: webmail.edu.example.com
admin_email: admin@example.com
```

密码可以不填，部署时会自动生成并保存到本地 `.secrets/` 和服务器 `credentials.txt`。

## 3. 先配 DNS

Cloudflare 里必须是 DNS only / 灰云：

```text
A     mail.edu.example.com       服务器IP
A     webmail.edu.example.com    服务器IP
MX    edu.example.com            10 mail.edu.example.com
TXT   edu.example.com            v=spf1 mx -all
TXT   _dmarc.edu.example.com     v=DMARC1; p=reject; rua=mailto:postmaster@edu.example.com
```

DKIM 记录会在部署完成后生成，因为要等 Stalwart 生成密钥。

## 4. 一键部署

如果已经配置 SSH key：

```bash
ansible-playbook deploy.yml
```

如果使用 SSH 密码：

```bash
ansible-playbook deploy.yml --ask-pass
```

## 5. 部署完成后

服务器上会生成：

```text
/opt/mail-stack/credentials.txt
/opt/mail-stack/dns-records.txt
```

查看：

```bash
ssh root@服务器IP
cat /opt/mail-stack/credentials.txt
cat /opt/mail-stack/dns-records.txt
```

入口：

```text
Stalwart:  https://mail.example.com/admin/
Roundcube: https://webmail.example.com/
工具站:    https://mail.example.com/tools/
```

## 常用命令

健康检查：

```bash
ansible-playbook health.yml
```

只输出 DNS 记录：

```bash
ansible-playbook dns.yml
```

重启服务：

```bash
ansible-playbook restart.yml
```

备份数据：

```bash
ansible-playbook backup.yml
```

## 端口

新服务器安全组需要开放：

```text
25, 80, 443, 465, 587, 993
```

如果只收信，公网发信能力不是重点，但 `25` 入站仍然要开放。

## 注意

- 不要把 `.secrets/` 提交到 GitHub。
- Cloudflare 代理必须关闭，邮件协议不能走橙云代理。
- 如果云厂商封了出站 25，不影响“只收信”，但会影响向外发信。
