import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import 'antd/dist/reset.css';
import {
  InboxOutlined,
  LogoutOutlined,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { MailToolsApp } from './App.jsx';
import './styles.css';

const iconSet = {
  InboxOutlined,
  LogoutOutlined,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UserAddOutlined,
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          colorBgLayout: '#0b0d12',
          colorBgContainer: '#11151c',
          colorBorder: '#2c3440',
          borderRadius: 8,
          fontFamily:
            'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Card: {
            headerBg: '#11151c',
          },
          Table: {
            headerBg: '#171c24',
          },
        },
      }}
    >
      <AntApp>
        <MailToolsApp icons={iconSet} />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
