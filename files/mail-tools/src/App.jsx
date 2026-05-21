import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Row,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { api } from './api.js';

const DEFAULT_MAIL_PASSWORD = '132456798oxy';
const DEFAULT_DOMAIN = 'edu.qlht.uk';

export function MailToolsApp({ icons }) {
  const { message, modal } = AntApp.useApp();
  const [session, setSession] = useState({ authenticated: false, user: null, domain: DEFAULT_DOMAIN });
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('accounts');
  const [bulkResultText, setBulkResultText] = useState('等待操作。');
  const [inboxResultText, setInboxResultText] = useState('等待操作。');
  const [accounts, setAccounts] = useState([]);
  const [accountsPage, setAccountsPage] = useState(1);
  const [accountsPageSize, setAccountsPageSize] = useState(20);
  const [accountsTotal, setAccountsTotal] = useState(0);
  const [accountsSearch, setAccountsSearch] = useState('');
  const [accountsSearchDraft, setAccountsSearchDraft] = useState('');
  const [createRows, setCreateRows] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [mailboxAuth, setMailboxAuth] = useState({
    address: `menherachan001@${DEFAULT_DOMAIN}`,
    password: DEFAULT_MAIL_PASSWORD,
  });
  const [loginForm] = Form.useForm();
  const [bulkForm] = Form.useForm();
  const [mailForm] = Form.useForm();

  const Icon = icons || {};
  const domain = session.domain || DEFAULT_DOMAIN;

  useEffect(() => {
    api('/api/session')
      .then((data) => setSession(data))
      .catch((err) => message.error(err.message))
      .finally(() => setSessionLoading(false));
  }, [message]);

  const loggedIn = Boolean(session.authenticated);

  useEffect(() => {
    if (!loggedIn || activeSection !== 'accounts') return;
    void loadAccounts({ page: accountsPage, pageSize: accountsPageSize, search: accountsSearch });
  }, [loggedIn, activeSection, accountsPage, accountsPageSize, accountsSearch]);

  async function handleLogin(values) {
    setLoginLoading(true);
    try {
      await api('/api/login', { method: 'POST', body: values });
      setSession({ authenticated: true, user: values.username, domain });
      message.success('登录成功');
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await api('/api/logout', { method: 'POST', body: {} });
    } catch {
      // Session may already be gone.
    }
    setSession({ authenticated: false, user: null, domain });
    setAccounts([]);
    setAccountsPage(1);
    setAccountsTotal(0);
    setAccountsSearch('');
    setAccountsSearchDraft('');
    setCreateRows([]);
    setMessages([]);
    setSelectedMessage(null);
    setActiveSection('accounts');
    setBulkResultText('等待操作。');
    setInboxResultText('等待操作。');
  }

  function openSection(key) {
    setActiveSection(key);
  }

  async function loadAccounts(options = {}) {
    const page = options.page || accountsPage;
    const pageSize = options.pageSize || accountsPageSize;
    const search = options.search ?? accountsSearch;
    setAccountsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) {
        params.set('search', search.trim());
      }
      const data = await api(`/api/accounts?${params}`);
      setAccounts((data.accounts || []).map((account) => ({ ...account, key: account.id || account.emailAddress })));
      setAccountsTotal(data.total || data.count || 0);
    } catch (err) {
      message.error(err.message);
    } finally {
      setAccountsLoading(false);
    }
  }

  async function openMailbox(address, password = DEFAULT_MAIL_PASSWORD) {
    const limit = mailForm.getFieldValue('limit') || 50;
    openSection('inbox');
    mailForm.setFieldsValue({ address, password, limit });
    await loadInbox({ address, password, limit });
  }

  async function previewAccounts() {
    try {
      const values = await bulkForm.validateFields();
      await runBulk(values, true);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.message);
    }
  }

  async function confirmCreate(values) {
    modal.confirm({
      title: '确认创建邮箱账号？',
      content: `${values.prefix}${String(values.start).padStart(values.width, '0')} 到 ${values.prefix}${String(values.end).padStart(values.width, '0')}，已存在的邮箱会自动跳过，密码不会被修改。`,
      okText: '创建',
      cancelText: '取消',
      onOk: () => runBulk(values, false),
    });
  }

  async function runBulk(values, dryRun) {
    setBulkLoading(true);
    try {
      const data = await api('/api/accounts/bulk-create', {
        method: 'POST',
        body: { ...values, dryRun },
      });
      if (dryRun) {
        setCreateRows(data.accounts.map(toCreateRow));
        setMessages([]);
        setSelectedMessage(null);
        setBulkResultText(
          `预览 ${data.summary.total} 个账号：可创建 ${data.summary.pending} 个，已存在 ${data.summary.existing} 个。`,
        );
        return;
      }
      const created = data.created || [];
      const skipped = data.skipped || [];
      const notCreated = data.notCreated || [];
      const rows = [
        ...created.map((row) => ({
          key: row.emailAddress,
          email: row.emailAddress,
          status: '成功',
          detail: row.id || '',
        })),
        ...skipped.map((row) => ({
          key: row.emailAddress,
          email: row.emailAddress,
          status: '已跳过',
          detail: row.reason || '邮箱已存在',
        })),
        ...notCreated.map((row) => ({
          key: row.emailAddress,
          email: row.emailAddress,
          status: '失败',
          detail: row.error || '',
        })),
      ];
      setCreateRows(rows);
      setMessages([]);
      setSelectedMessage(null);
      if (activeSection === 'accounts') {
        void loadAccounts({ page: accountsPage, pageSize: accountsPageSize, search: accountsSearch });
      }
      setBulkResultText(
        `创建完成：成功 ${created.length} 个，跳过 ${skipped.length} 个，失败 ${notCreated.length} 个。`,
      );
    } catch (err) {
      message.error(err.message);
      setBulkResultText(err.message);
    } finally {
      setBulkLoading(false);
    }
  }

  async function loadInbox(values) {
    setMailLoading(true);
    setSelectedMessage(null);
    try {
      const address = values.address.trim();
      const params = new URLSearchParams({
        password: values.password,
        limit: String(values.limit || 50),
      });
      const data = await api(`/api/mailboxes/${encodeURIComponent(address)}/messages?${params}`);
      setMailboxAuth({ address, password: values.password });
      setMessages(data.messages.map((item) => ({ ...item, key: item.uid })));
      setCreateRows([]);
      openSection('inbox');
      setInboxResultText(`${data.address} 收件箱：${data.messages.length} 封邮件。`);
      if (!data.messages.length) {
        message.info('收件箱暂无邮件');
      }
    } catch (err) {
      message.error(err.message);
      setInboxResultText(err.message);
    } finally {
      setMailLoading(false);
    }
  }

  async function loadMessage(uid) {
    if (!mailboxAuth.address || !mailboxAuth.password) return;
    setMessageLoading(true);
    try {
      const params = new URLSearchParams({ password: mailboxAuth.password });
      const data = await api(
        `/api/mailboxes/${encodeURIComponent(mailboxAuth.address)}/messages/${uid}?${params}`,
      );
      setSelectedMessage(data.message);
      openSection('inbox');
      setInboxResultText(`已打开邮件 #${uid}。`);
    } catch (err) {
      message.error(err.message);
      setInboxResultText(err.message);
    } finally {
      setMessageLoading(false);
    }
  }

  const createColumns = useMemo(() => [
    { title: '邮箱', dataIndex: 'email', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status) => <Tag color={statusColor(status)}>{status}</Tag>,
    },
    { title: '详情', dataIndex: 'detail', ellipsis: true },
  ], []);

  const messageColumns = useMemo(() => [
    {
      title: '状态',
      dataIndex: 'seen',
      width: 88,
      render: (seen) => <Tag color={seen ? 'default' : 'green'}>{seen ? '已读' : '未读'}</Tag>,
    },
    { title: '发件人', dataIndex: 'from', ellipsis: true },
    {
      title: '主题',
      dataIndex: 'subject',
      ellipsis: true,
      render: (value) => value || '(无主题)',
    },
    {
      title: '时间',
      dataIndex: 'date',
      width: 180,
      render: formatDate,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 110,
      render: formatSize,
    },
  ], []);

  const sidebarItems = [
    { key: 'accounts', icon: <Icon.AppstoreOutlined />, label: '邮箱账号' },
    { key: 'bulk', icon: <Icon.UserAddOutlined />, label: '批量创建' },
    { key: 'inbox', icon: <Icon.InboxOutlined />, label: '查看收件箱' },
  ];

  const accountColumns = [
    { title: '邮箱地址', dataIndex: 'emailAddress', ellipsis: true },
    { title: '名称', dataIndex: 'name', width: 180, ellipsis: true },
    {
      title: '已用空间',
      dataIndex: 'usedDiskQuota',
      width: 120,
      render: formatSize,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: formatDate,
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_, record) => (
        <Button
          type="link"
          icon={<Icon.InboxOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            openMailbox(record.emailAddress);
          }}
        >
          查看收件箱
        </Button>
      ),
    },
  ];

  if (sessionLoading) {
    return (
      <Layout className="app-shell centered">
        <Card className="login-card">
          <Space direction="vertical" size={12}>
            <Typography.Title level={3}>邮箱工具</Typography.Title>
            <Typography.Text type="secondary">正在检查登录状态...</Typography.Text>
          </Space>
        </Card>
      </Layout>
    );
  }

  if (!loggedIn) {
    return (
      <Layout className="app-shell centered">
        <Card className="login-card" title="邮箱工具">
          <Form form={loginForm} layout="vertical" onFinish={handleLogin} autoComplete="on">
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loginLoading} block size="large">
              登录
            </Button>
          </Form>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout className="app-shell">
      <Layout.Sider
        width={248}
        breakpoint="lg"
        collapsedWidth="0"
        className="app-sider"
      >
        <div className="sider-brand">
          <Typography.Title level={4} className="sider-title">
            邮箱工具
          </Typography.Title>
          <Typography.Text type="secondary" className="sider-domain">
            {domain}
          </Typography.Text>
        </div>
        <Menu
          className="sider-menu"
          mode="inline"
          selectedKeys={[activeSection]}
          items={sidebarItems}
          onClick={({ key }) => {
            openSection(key);
          }}
        />
        <div className="sider-footer">
          <Typography.Text type="secondary">已登录</Typography.Text>
          <Typography.Text className="sider-user">{session.user || 'admin'}</Typography.Text>
        </div>
      </Layout.Sider>

      <Layout className="main-layout">
        <Layout.Header className="app-header">
          <div>
            <Typography.Title level={3} className="page-title">
              邮箱工具
            </Typography.Title>
            <Typography.Text type="secondary">
              已登录：{session.user || 'admin'}，域名：{domain}
            </Typography.Text>
          </div>
          <Button icon={<Icon.LogoutOutlined />} onClick={handleLogout}>
            退出
          </Button>
        </Layout.Header>

        <Layout.Content className="app-content">
          {activeSection === 'accounts' ? (
            <Card
              className="page-card"
              title={
                <Space>
                  <Icon.AppstoreOutlined />
                  <span>邮箱账号</span>
                </Space>
              }
              extra={
                <Space wrap>
                  <Input.Search
                    allowClear
                    placeholder="搜索邮箱或名称"
                    value={accountsSearchDraft}
                    onChange={(event) => {
                      const nextSearch = event.target.value;
                      setAccountsSearchDraft(nextSearch);
                      if (!nextSearch) {
                        setAccountsSearch('');
                        setAccountsPage(1);
                      }
                    }}
                    onSearch={(value) => {
                      setAccountsSearch(value.trim());
                      setAccountsPage(1);
                    }}
                    className="account-search"
                  />
                  <Button
                    icon={<Icon.ReloadOutlined />}
                    loading={accountsLoading}
                    onClick={() => loadAccounts({ page: accountsPage, pageSize: accountsPageSize, search: accountsSearch })}
                  >
                    刷新
                  </Button>
                </Space>
              }
            >
              <Table
                size="middle"
                columns={accountColumns}
                dataSource={accounts}
                loading={accountsLoading}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无邮箱账号" /> }}
                pagination={{
                  current: accountsPage,
                  pageSize: accountsPageSize,
                  total: accountsTotal,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 个邮箱`,
                }}
                scroll={{ x: 860 }}
                onChange={(pagination) => {
                  setAccountsPage(pagination.current || 1);
                  setAccountsPageSize(pagination.pageSize || 20);
                }}
                onRow={(record) => ({
                  onClick: () => openMailbox(record.emailAddress),
                  className: 'clickable-row',
                })}
              />
            </Card>
          ) : null}

          {activeSection === 'bulk' ? (
            <Card
              className="page-card"
              title={
                <Space>
                  <Icon.UserAddOutlined />
                  <span>批量创建邮箱</span>
                </Space>
              }
            >
              <Form
                form={bulkForm}
                layout="vertical"
                initialValues={{
                  prefix: 'menherachan',
                  start: 101,
                  end: 110,
                  width: 3,
                  domain,
                  password: DEFAULT_MAIL_PASSWORD,
                }}
                onFinish={confirmCreate}
              >
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="prefix"
                      label="前缀"
                      rules={[{ required: true, message: '请输入前缀' }]}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="start"
                      label="起始编号"
                      rules={[{ required: true, message: '请输入起始编号' }]}
                    >
                      <InputNumber min={0} precision={0} className="full-width" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="end"
                      label="结束编号"
                      rules={[{ required: true, message: '请输入结束编号' }]}
                    >
                      <InputNumber min={0} precision={0} className="full-width" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="width"
                      label={
                        <Tooltip title="编号左侧补 0 到指定长度，例如 1 + 3 位会变成 001。">
                          <span>补零位数</span>
                        </Tooltip>
                      }
                      rules={[{ required: true, message: '请输入补零位数' }]}
                    >
                      <InputNumber min={1} max={10} precision={0} className="full-width" />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item name="domain" label="域名" rules={[{ required: true, message: '请输入域名' }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      name="password"
                      label="邮箱密码"
                      rules={[{ required: true, message: '请输入邮箱密码' }]}
                    >
                      <Input.Password autoComplete="new-password" />
                    </Form.Item>
                  </Col>
                </Row>
                <Space wrap>
                  <Button icon={<Icon.SearchOutlined />} onClick={previewAccounts} loading={bulkLoading}>
                    预览
                  </Button>
                  <Button type="primary" icon={<Icon.PlusOutlined />} htmlType="submit" loading={bulkLoading}>
                    创建
                  </Button>
                </Space>
              </Form>
              <div className="embedded-section">
                <div className="embedded-panel">
                  <div className="embedded-panel-header">
                    <Typography.Title level={5}>创建结果</Typography.Title>
                    <Typography.Text type="secondary">{bulkResultText}</Typography.Text>
                  </div>
                  {createRows.length ? (
                    <Table
                      size="small"
                      columns={createColumns}
                      dataSource={createRows}
                      pagination={{ pageSize: 10, showSizeChanger: true }}
                      scroll={{ x: 760 }}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无创建结果" />
                  )}
                </div>
              </div>
            </Card>
          ) : null}

          {activeSection === 'inbox' ? (
            <Card
              className="page-card"
              title={
                <Space>
                  <Icon.InboxOutlined />
                  <span>查看收件箱</span>
                </Space>
              }
            >
              <Form
                form={mailForm}
                layout="vertical"
                initialValues={{
                  address: `menherachan001@${domain}`,
                  password: DEFAULT_MAIL_PASSWORD,
                  limit: 50,
                }}
                onFinish={loadInbox}
              >
                <Form.Item
                  name="address"
                  label="邮箱地址"
                  rules={[
                    { required: true, message: '请输入邮箱地址' },
                    { type: 'email', message: '邮箱地址格式不正确' },
                  ]}
                >
                  <Input autoComplete="username" />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="邮箱密码"
                  rules={[{ required: true, message: '请输入邮箱密码' }]}
                >
                  <Input.Password autoComplete="current-password" />
                </Form.Item>
                <Row gutter={12} align="bottom">
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="limit"
                      label="读取数量"
                      rules={[{ required: true, message: '请输入读取数量' }]}
                    >
                      <InputNumber min={1} max={100} precision={0} className="full-width" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label=" ">
                      <Button
                        type="primary"
                        icon={<Icon.ReloadOutlined />}
                        htmlType="submit"
                        loading={mailLoading}
                      >
                        刷新
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
              <div className="embedded-section">
                <div className="embedded-panel">
                  <div className="embedded-panel-header">
                    <Typography.Title level={5}>收件箱结果</Typography.Title>
                    <Typography.Text type="secondary">{inboxResultText}</Typography.Text>
                  </div>
                  {messages.length ? (
                    <Table
                      size="small"
                      columns={messageColumns}
                      dataSource={messages}
                      pagination={{ pageSize: 10, showSizeChanger: true }}
                      scroll={{ x: 760 }}
                      onRow={(record) => ({
                        onClick: () => loadMessage(record.uid),
                        className: 'clickable-row',
                      })}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无收件箱结果" />
                  )}
                </div>
              </div>
              <div className="embedded-section">
                <div className="embedded-panel">
                  <div className="embedded-panel-header">
                    <Typography.Title level={5}>邮件内容</Typography.Title>
                  </div>
                  <Spin spinning={messageLoading}>
                    {selectedMessage ? (
                      <Space direction="vertical" size={16} className="full-width">
                        <Descriptions
                          size="small"
                          column={{ xs: 1, md: 2 }}
                          items={[
                            { key: 'from', label: '发件人', children: selectedMessage.from || '-' },
                            { key: 'to', label: '收件人', children: selectedMessage.to || '-' },
                            { key: 'subject', label: '主题', children: selectedMessage.subject || '(无主题)' },
                            { key: 'date', label: '时间', children: formatDate(selectedMessage.date) || '-' },
                          ]}
                        />
                        {selectedMessage.attachments?.length ? (
                          <Alert
                            type="info"
                            showIcon
                            message={`附件：${selectedMessage.attachments
                              .map((item) => `${item.filename} (${formatSize(item.size)})`)
                              .join('，')}`}
                          />
                        ) : null}
                        {selectedMessage.html ? (
                          <iframe className="message-frame" sandbox="" srcDoc={selectedMessage.html} title="邮件正文" />
                        ) : (
                          <pre className="message-text">{selectedMessage.text || '(无正文)'}</pre>
                        )}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一封邮件查看正文" />
                    )}
                  </Spin>
                </div>
              </div>
            </Card>
          ) : null}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function toCreateRow(account) {
  const status = account.status === 'exists' ? '已存在' : '待创建';
  return {
    key: account.emailAddress,
    email: account.emailAddress,
    status,
    detail: account.detail || '',
  };
}

function statusColor(status) {
  if (status === '成功') return 'green';
  if (status === '失败') return 'red';
  if (status === '已存在' || status === '已跳过') return 'gold';
  return 'blue';
}

function formatSize(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
