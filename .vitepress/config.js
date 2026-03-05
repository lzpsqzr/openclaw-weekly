import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'OpenClaw Weekly',
  description: 'OpenClaw 仓库每周动向追踪 - Your personal AI assistant, the lobster way 🦞',
  // base 配置必须与仓库名称一致，格式为 '/仓库名/'
  // 如果仓库名是 openclaw-weekly，则保持下方配置
  // 如果仓库名是其他名称，请修改为 '/你的仓库名/'
  base: '/openclaw-weekly/',

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],

  ignoreDeadLinks: true,

  themeConfig: {
    logo: '/favicon.ico',

    nav: [
      { text: '首页', link: '/' },
      { text: '周报列表', link: '/docs/09' },
      { text: 'OpenClaw官网', link: 'https://openclaw.ai/' },
      { text: 'GitHub', link: 'https://github.com/openclaw/openclaw' }
    ],

    sidebar: [
      {
        text: '2026年3月',
        items: [
          {
            text: '第9期：2026年2月23日-2026年3月2日',
            link: '/docs/09'
          }
        ]
      },
      {
        text: '2026年2月',
        items: [
          {
            text: '第8期：2026年2月16日-2026年2月23日',
            link: '/docs/08'
          },
          {
            text: '第7期：2026年2月9日-2026年2月16日',
            link: '/docs/07'
          },
          {
            text: '第6期：2026年2月2日-2026年2月9日',
            link: '/docs/06'
          },
          {
            text: '第5期：2026年1月26日-2026年2月2日',
            link: '/docs/05'
          }
        ]
      },
      {
        text: '2026年1月',
        items: [
          {
            text: '第4期：2026年1月19日-2026年1月26日',
            link: '/docs/04'
          },
          {
            text: '第3期：2026年1月12日-2026年1月19日',
            link: '/docs/03'
          },
          {
            text: '第2期：2026年1月5日-2026年1月12日',
            link: '/docs/02'
          },
          {
            text: '第1期：2025年12月29日-2026年1月5日',
            link: '/docs/01'
          }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/openclaw/openclaw' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 OpenClaw Weekly'
    },

    search: {
      provider: 'local'
    }
  },

  markdown: {
    lineNumbers: true
  }
})
