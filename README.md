# Mail Stack Deploy

Ansible playbooks for deploying a self-hosted mail stack on a remote Linux server.

The stack includes:

- [Stalwart Mail Server](https://stalw.art/) for SMTP, IMAP, POP3, JMAP, DKIM, and domain management
- [Roundcube](https://roundcube.net/) as the webmail client
- A React + Ant Design administration tool for:
  - bulk mailbox creation with existing-account detection and safe skipping
  - inbox lookup by mailbox credentials
  - message preview
- Nginx reverse proxy
- Let's Encrypt certificates through Certbot

## Architecture

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

Default public endpoints:

```text
Stalwart Admin: https://mail.example.com/admin/
Mail Tools:     https://mail.example.com/tools/
Roundcube:      https://webmail.example.com/
```

## Server Requirements

Target server:

- Linux server with root SSH access
- Supported families:
  - RHEL-compatible: OpenCloudOS, CentOS, Rocky Linux, AlmaLinux
  - Debian-compatible: Debian, Ubuntu
- 2 GB RAM minimum, 4 GB or more recommended
- 30 GB disk minimum recommended
- No existing mail server listening on SMTP/IMAP ports
- Public IPv4 address

Open these inbound ports in the cloud security group:

```text
25, 80, 443, 465, 587, 993
```

Optional but recommended:

```text
110, 143, 995, 4190
```

Port `25` inbound is required for receiving mail. If the provider blocks outbound `25`, receiving mail still works, but external delivery may be limited.

### Port Handling

Mail protocol ports are fixed and must be available on the server:

```text
25, 465, 587, 993
```

The playbook also checks common optional mail ports:

```text
110, 143, 995, 4190
```

These ports are part of standard SMTP, IMAP, POP3, and ManageSieve behavior. The playbook does not automatically move them to random ports.

Web-facing services are different. Stalwart Admin, Roundcube, and Mail Tools are exposed to the local reverse proxy through `127.0.0.1` ports. If a local web upstream port is already occupied, the playbook can automatically choose a free port from the configured range.

Default behavior:

```yaml
web_proxy_mode: auto
auto_select_local_ports: true
local_port_range_start: 18080
local_port_range_end: 18199
```

`web_proxy_mode` supports:

- `auto`: use managed Nginx when ports `80/443` are free or already owned by Nginx; otherwise switch to external reverse proxy mode.
- `managed`: install and manage Nginx and Certbot directly on ports `80/443`.
- `external`: do not manage public Nginx vhosts; generate upstream information for an existing reverse proxy.

When `80/443` are occupied by another service, keep `web_proxy_mode: auto` or set:

```yaml
web_proxy_mode: external
```

The deployment will write:

```text
/opt/mail-stack/external-proxy-upstreams.txt
```

Use that file to connect the existing Nginx, Caddy, 1Panel, BT panel, or other reverse proxy to the local upstream ports selected by the playbook.

## DNS Requirements

Use DNS-only records. For Cloudflare, disable proxying for all mail-related records.

Example for `example.com`:

```text
A     mail.example.com       SERVER_IP
A     webmail.example.com    SERVER_IP
MX    example.com            10 mail.example.com
TXT   example.com            v=spf1 mx -all
TXT   _dmarc.example.com     v=DMARC1; p=reject; rua=mailto:postmaster@example.com
```

DKIM records are generated after Stalwart is initialized. The playbook writes them to:

```text
/opt/mail-stack/dns-records.txt
```

## Control Host Requirements

Run Ansible from any machine that can SSH into the target server.

Required locally:

```text
ansible
ssh
```

No external Ansible Galaxy collections are required.

## Configuration

Edit `inventory.yml`:

```yaml
mail_servers:
  hosts:
    mail01:
      ansible_host: 1.2.3.4
      ansible_user: root
```

Edit `group_vars/all.yml`:

```yaml
domain: example.com
mail_host: mail.example.com
webmail_host: webmail.example.com
admin_email: admin@example.com
```

Optional passwords can be left empty:

```yaml
bootstrap_recovery_password: ""
stalwart_admin_password: ""
tools_admin_password: ""
mail_tools_session_secret: ""
```

When empty, the playbook generates stable secrets under:

```text
.secrets/<inventory-host>/
```

These files must not be committed.

Optional port settings:

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

The four service ports above are preferred local ports. If any preferred port is already used and `auto_select_local_ports` is enabled, the playbook selects another free port from the range.

## Deployment

With SSH key authentication:

```bash
ansible-playbook deploy.yml
```

With SSH password authentication:

```bash
ansible-playbook deploy.yml --ask-pass
```

The deployment performs:

1. Package installation
2. Public web port detection
3. Local upstream port selection
4. Docker setup
5. Nginx and Certbot setup when `web_proxy_mode` is managed
6. Stalwart bootstrap initialization
7. Roundcube deployment
8. Mail Tools build and deployment
9. Nginx reverse proxy configuration or external upstream note generation
10. Let's Encrypt certificate issuance when managed Nginx is active
11. Health checks
12. DNS record export

## Generated Files On Server

```text
/opt/mail-stack/.env
/opt/mail-stack/credentials.txt
/opt/mail-stack/dns-records.txt
/opt/mail-stack/compose.yml
/opt/mail-stack/external-proxy-upstreams.txt
/opt/mail-stack/scripts/
```

Credentials:

```bash
cat /opt/mail-stack/credentials.txt
```

DNS records:

```bash
cat /opt/mail-stack/dns-records.txt
```

## Operations

Health check:

```bash
ansible-playbook health.yml
```

Print DNS records:

```bash
ansible-playbook dns.yml
```

Restart services:

```bash
ansible-playbook restart.yml
```

Create a backup archive:

```bash
ansible-playbook backup.yml
```

Backups are stored under:

```text
/opt/mail-stack/backups/
```

## Important Notes

- Mail-related DNS records must not be proxied by Cloudflare.
- Keep `.secrets/` private.
- Review `/opt/mail-stack/dns-records.txt` after deployment and add the generated DKIM records.
- For production use, configure reverse DNS/PTR for the mail server IP when outbound delivery matters.
