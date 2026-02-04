#!/usr/bin/env node

/**
 * OpenClaw Weekly 自动化周报生成器
 * 根据时间线自动搜集 OpenClaw 官方仓库的数据并生成周报
 * The lobster way! 🦞
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置
const CONFIG = {
  repos: [
    { owner: 'openclaw', name: 'openclaw', displayName: 'OpenClaw主仓库' }
    // Note: docs repo doesn't exist yet - uncomment when it's available
    // { owner: 'openclaw', name: 'docs', displayName: 'OpenClaw文档' }
  ],
  github: {
    apiBase: 'https://api.github.com',
    token: process.env.GITHUB_TOKEN // 需要设置环境变量
  },
  ai: {
    // 支持多种 AI 服务，优先级从高到低
    providers: [
      {
        name: 'dify',
        apiKey: process.env.DIFY_API_KEY,
        baseUrl: 'https://dify-api.pp.dktapp.cloud/v1/workflows/run',
        user: 'openclaw-weekly-bot'
      },
      {
        name: 'qwen',
        apiKey: process.env.QWEN_API_KEY,
        model: 'qwen-max', // 或 qwen-plus, qwen-turbo
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
      },
      {
        name: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com/v1'
      },
      {
        name: 'claude',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-3-sonnet-20240229'
      }
    ]
  }
}

/**
 * GitHub API 请求封装
 */
async function githubRequest(endpoint, params = {}) {
  const url = new URL(`${CONFIG.github.apiBase}${endpoint}`)
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined) {
      url.searchParams.append(key, params[key])
    }
  })

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'OpenClaw-Weekly-Bot'
  }

  if (CONFIG.github.token) {
    headers['Authorization'] = `token ${CONFIG.github.token}`
  }

  try {
    const response = await fetch(url.toString(), { headers })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error.message)
    return null
  }
}

/**
 * 获取指定时间范围内的仓库数据
 */
async function getWeeklyData(owner, repo, startDate, endDate, path = null, pathDisplayName = null) {
  const displayName = pathDisplayName ? `${owner}/${repo}/${path} (${pathDisplayName})` : `${owner}/${repo}`
  console.log(`📊 正在获取 ${displayName} 的周数据...`)

  const [repoInfo, commitCount, releases, prs, topIssues] = await Promise.all([
    getRepoInfo(owner, repo),
    getCommitCount(owner, repo, startDate, endDate),
    getReleases(owner, repo, startDate, endDate),
    getPullRequests(owner, repo, startDate, endDate),
    getTopIssues(owner, repo, startDate, endDate, 5)
  ])

  return {
    repo: { owner, name: repo, path, pathDisplayName },
    info: repoInfo,
    commits: { total: commitCount },  // 简化结构，只有数量
    releases,
    prs,
    issues: { total: topIssues.totalCount, issues: topIssues.topIssues },  // total 是总数，issues 是热门 Issue
    period: { start: startDate, end: endDate }
  }
}

/**
 * 获取仓库基本信息
 */
async function getRepoInfo(owner, repo) {
  const data = await githubRequest(`/repos/${owner}/${repo}`)
  if (!data) return null

  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    language: data.language,
    description: data.description,
    updatedAt: data.updated_at
  }
}

/**
 * 获取指定时间范围内的提交数量（使用 Search API 获取准确计数）
 */
async function getCommitCount(owner, repo, since, until) {
  const startDate = since.toISOString().split('T')[0]
  const endDate = until.toISOString().split('T')[0]
  const query = `repo:${owner}/${repo} author-date:${startDate}..${endDate}`

  try {
    const data = await githubRequest('/search/commits', {
      q: query,
      per_page: 1
    })

    if (data && data.total_count !== undefined) {
      console.log(`📊 ${owner}/${repo}: 找到 ${data.total_count} 次提交`)
      return data.total_count
    }
  } catch (error) {
    console.warn(`⚠️ Search API 请求失败，回退到普通 API: ${error.message}`)
    // 回退到普通 API
    const params = {
      since: since.toISOString(),
      until: until.toISOString(),
      per_page: 100
    }
    const data = await githubRequest(`/repos/${owner}/${repo}/commits`, params)
    return data ? data.length : 0
  }

  return 0
}

/**
 * 获取指定时间范围内的发布
 */
async function getReleases(owner, repo, since, until) {
  const data = await githubRequest(`/repos/${owner}/${repo}/releases`, {
    per_page: 50
  })

  if (!data) return []

  return data.filter(release => {
    const publishedAt = new Date(release.published_at)
    return publishedAt >= since && publishedAt <= until
  }).map(release => ({
    tagName: release.tag_name,
    name: release.name,
    publishedAt: release.published_at,
    prerelease: release.prerelease,
    draft: release.draft,
    body: release.body,
    url: release.html_url
  }))
}

/**
 * 获取指定时间范围内的PR（使用 Search API）
 */
async function getPullRequests(owner, repo, since, until) {
  const startDate = since.toISOString().split('T')[0]
  const endDate = until.toISOString().split('T')[0]
  const query = `repo:${owner}/${repo} created:${startDate}..${endDate} type:pr`

  try {
    const data = await githubRequest('/search/issues', {
      q: query,
      per_page: 100,
      sort: 'created',
      order: 'desc'
    })

    if (data && data.items) {
      const totalCount = data.total_count || data.items.length
      console.log(`🔀 ${owner}/${repo}: 找到 ${totalCount} 个 PR`)

      const prs = data.items.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: pr.user.login,
        createdAt: pr.created_at,
        mergedAt: pr.pull_request?.merged_at,
        url: pr.html_url
      }))

      const merged = prs.filter(pr => pr.mergedAt).length
      const open = prs.filter(pr => pr.state === 'open').length

      return {
        total: totalCount,
        merged,
        open,
        prs
      }
    }
  } catch (error) {
    console.warn(`⚠️ PR Search API 请求失败: ${error.message}`)
  }

  return { total: 0, merged: 0, open: 0, prs: [] }
}

/**
 * 获取指定时间范围内最热门的 Issues（按点赞排序）
 */
async function getTopIssues(owner, repo, since, until, limit = 5) {
  const startDate = since.toISOString().split('T')[0]
  const endDate = until.toISOString().split('T')[0]
  const query = `repo:${owner}/${repo} created:${startDate}..${endDate} type:issue`

  try {
    const data = await githubRequest('/search/issues', {
      q: query,
      per_page: 100,
      sort: 'reactions',
      order: 'desc'
    })

    if (data && data.items) {
      // 过滤掉 PR，只保留 Issue
      const issuesOnly = data.items.filter(item => !item.pull_request)
      const totalCount = data.total_count || issuesOnly.length

      // 计算每个 issue 的总反应数
      const issuesWithReactions = issuesOnly.map(issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        user: issue.user.login,
        reactions: issue.reactions?.total_count || 0,
        createdAt: issue.created_at,
        closedAt: issue.closed_at,
        url: issue.html_url
      }))

      // 按反应数排序并返回前 N 个
      const topIssues = issuesWithReactions
        .sort((a, b) => b.reactions - a.reactions)
        .slice(0, limit)

      console.log(`🔍 ${owner}/${repo}: 找到 ${totalCount} 个 Issue，显示最热门的 ${topIssues.length} 个`)

      return { totalCount, topIssues }
    }
  } catch (error) {
    console.warn(`⚠️ Issue Search API 请求失败: ${error.message}`)
  }

  return { totalCount: 0, topIssues: [] }
}

/**
 * AI 分析功能
 */
async function analyzeWithAI(data, analysisType) {
  // 获取可用的 AI 提供商
  const availableProvider = CONFIG.ai.providers.find(provider => {
    if (provider.name === 'dify') {
      return provider.apiKey && provider.apiKey.length > 0
    } else if (provider.name === 'qwen') {
      return provider.apiKey && provider.apiKey.length > 0
    } else if (provider.name === 'openai') {
      return provider.apiKey && provider.apiKey.startsWith('sk-')
    } else if (provider.name === 'claude') {
      return provider.apiKey && provider.apiKey.startsWith('sk-ant-')
    }
    return false
  })

  if (!availableProvider) {
    console.log('⚠️ 未配置 AI API Key，跳过智能分析')
    return null
  }

  console.log(`🤖 使用 ${availableProvider.name} 进行智能分析...`)

  // Debug 模式：打印详细的请求信息
  const debugMode = process.env.DEBUG === 'true' || process.env.AI_DEBUG === 'true'

  // 构建提示词
  let prompt = ''

  if (analysisType === 'releases') {
    prompt = `请分析 data_content 中的 OpenClaw 版本发布信息，生成详细的中文分析，突出重要功能和改进。

请提供：
1. 主要新功能概述（4-6句话）
2. 重要改进点（2-3句话）
3. 对用户的影响（2句话）

要求详细列出新版本的改动，并突出重点。OpenClaw 是一个个人 AI 助手，支持多渠道（WhatsApp、Telegram、Slack、Discord 等）集成。`
  } else if (analysisType === 'prs') {
    prompt = `请分析 data_content 中的 OpenClaw 仓库 Pull Request 信息，提取重要的开发动向。

请提供：
1. 主要开发方向（2-4句话）
2. 重要功能或修复（列出2-3个关键点）
3. 社区活跃度评价（1句话）

要求简洁专业，突出技术重点。OpenClaw 是一个个人 AI 助手项目，重点关注多渠道集成、Gateway 控制平面、语音功能、Canvas 等特性。`
  } else if (analysisType === 'issues') {
    prompt = `请分析 data_content 中的 OpenClaw 仓库 Issue 信息，总结用户关注的热点。

请提供：
1. 用户主要关注点（4-6句话）
2. 常见问题类型（2-3个关键词）
3. 社区反馈趋势（1句话）

要求简洁明了，体现用户需求。OpenClaw 是一个个人 AI 助手，支持多种消息渠道和平台。`
  } else if (analysisType === 'commits') {
    prompt = `请分析 data_content 中的代码提交信息，总结开发动向和技术更新。

请提供：
1. 主要开发活动（2-3句话）
2. 技术改进重点（列出2-3个关键点）
3. 代码质量和功能演进趋势（1句话）

要求简洁专业，突出技术发展方向。OpenClaw 是一个个人 AI 助手项目。`
  }

  // Debug 模式：显示完整的请求信息
  if (debugMode) {
    console.log('\n🔍 [DEBUG] AI 请求详情:')
    console.log('📝 分析类型:', analysisType)
    console.log('📊 原始数据预览:', JSON.stringify(data).substring(0, 200) + '...')
    console.log('📊 数据长度:', JSON.stringify(data).length, '字符')
    console.log('💬 提示词预览:', prompt.substring(0, 150) + '...')
    console.log('🔗 服务提供商:', availableProvider.name)
    console.log('🌐 API 端点:', availableProvider.baseUrl)

    if (availableProvider.name === 'dify') {
      console.log('\n📤 [DEBUG] 发送给 Dify 的完整内容:')
      console.log('┌─ inputs.analysis_type:', analysisType)
      console.log('├─ inputs.data_content 长度:', JSON.stringify(data).length, '字符')
      console.log('├─ inputs.prompt 长度:', prompt.length, '字符')
      console.log('├─ response_mode: blocking')
      console.log('└─ user:', availableProvider.user)
      console.log('\n💬 [DEBUG] 完整 prompt 内容:')
      console.log('─'.repeat(50))
      console.log(prompt)
      console.log('─'.repeat(50))
      console.log('\n📊 [DEBUG] 完整 data_content:')
      console.log('─'.repeat(50))
      console.log(JSON.stringify(data, null, 2))
      console.log('─'.repeat(50))
    }
  }

  try {
    if (availableProvider.name === 'dify') {
      // 准备发送给 Dify 的数据，检查长度限制
      let dataContent = JSON.stringify(data)
      const maxLength = 16384 // Dify data_content 字段最大长度限制

      if (dataContent.length > maxLength) {
        // 如果数据过长，进行截断处理
        dataContent = dataContent.substring(0, maxLength - 3) + '...'

        if (debugMode) {
          console.log(`⚠️ [DEBUG] data_content 长度超限，已截断:`)
          console.log(`├─ 原始长度: ${JSON.stringify(data).length} 字符`)
          console.log(`├─ 截断后长度: ${dataContent.length} 字符`)
          console.log(`└─ 最大限制: ${maxLength} 字符`)
        }
      }

      // 使用内部 Dify 平台进行分析
      const response = await fetch(availableProvider.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${availableProvider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: {
            analysis_type: analysisType,
            data_content: dataContent,
            prompt: prompt
          },
          response_mode: 'blocking', // 使用 blocking mode
          user: availableProvider.user
        })
      })

      if (response.ok) {
        const result = await response.json()
        return result.data?.outputs?.result || result.answer || '分析完成，但未返回具体内容'
      }
    } else if (availableProvider.name === 'qwen') {
      // 使用阿里云 Qwen 进行分析
      const response = await fetch(availableProvider.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${availableProvider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: availableProvider.model,
          input: {
            messages: [
              {
                role: 'system',
                content: '你是一个专业的技术分析师，专门分析开源项目的发展动向。请用简洁专业的中文回答。'
              },
              {
                role: 'user',
                content: prompt
              }
            ]
          },
          parameters: {
            max_tokens: 500,
            temperature: 0.7
          }
        })
      })

      if (response.ok) {
        const result = await response.json()
        return result.output?.choices?.[0]?.message?.content?.trim() || '分析完成，但未返回具体内容'
      }
    } else if (availableProvider.name === 'openai') {
      const response = await fetch(`${availableProvider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${availableProvider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: availableProvider.model,
          messages: [
            {
              role: 'system',
              content: '你是一个专业的技术分析师，专门分析开源项目的发展动向。请用简洁专业的中文回答。'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 500,
          temperature: 0.7
        })
      })

      if (response.ok) {
        const result = await response.json()
        return result.choices[0].message.content.trim()
      }
    }

    return null
  } catch (error) {
    console.error(`AI 分析失败 (${analysisType}):`, error.message)
    return null
  }
}

/**
 * 生成周报内容（增强版，包含 AI 分析）
 */
async function generateWeeklyContent(weeklyData, weekNumber, startDate, endDate) {
  const formatDate = (date) => {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}年${month}月${day}日`
  }

  const startStr = formatDate(startDate)
  const endStr = formatDate(endDate)

  let content = `# 第${weekNumber}期【${startStr}-${endStr}】

## 📊 本周活动概览

| 仓库 | 新增Commit | 新增PR | 新增Issue | 版本发布 |
|------|------------|--------|-----------|----------|`

  // 添加各仓库的活动数据概览
  weeklyData.forEach(data => {
    const repoDisplayName = CONFIG.repos.find(r => r.name === data.repo.name && r.path === data.repo.path)?.displayName || data.repo.name
    const pathDisplayName = data.repo.pathDisplayName ? ` (${data.repo.pathDisplayName})` : ''
    const fullDisplayName = `${repoDisplayName}${pathDisplayName}`
    const releaseCount = data.releases.length

    content += `\n| ${fullDisplayName} | ${data.commits.total} | ${data.prs.total} | ${data.issues.total} | ${releaseCount} |`
  })

  // 重要更新部分（包含 AI 分析）
  content += `\n\n## 🚀 重要更新\n`

  for (const data of weeklyData) {
    if (data.releases.length > 0) {
      content += `\n### ${data.repo.name} 版本发布\n`

      for (const release of data.releases) {
        content += `\n**${release.tagName}** - ${release.name}\n`
        content += `- 发布时间: ${new Date(release.publishedAt).toLocaleDateString()}\n`

        // AI 分析版本发布内容
        if (release.body) {
          const aiAnalysis = await analyzeWithAI([release], 'releases')
          if (aiAnalysis) {
            content += `\n**🤖 AI 分析**:\n${aiAnalysis}\n`
          }

          const shortBody = release.body.substring(0, 200) + (release.body.length > 200 ? '...' : '')
          content += `- 更新内容: ${shortBody}\n`
        }
        content += `- [查看详情](${release.url})\n`
      }
    }
  }

  // 如果没有版本发布，添加一个占位说明
  const hasReleases = weeklyData.some(data => data.releases.length > 0)
  if (!hasReleases) {
    content += `\n本周暂无版本发布。\n`
  }

  // 分类分析各仓库的更新内容
  content += `\n## 🔄 本周更新分析\n`

  for (const data of weeklyData) {
    const repoDisplayName = CONFIG.repos.find(r => r.name === data.repo.name)?.displayName || data.repo.name
    const pathDisplayName = data.repo.pathDisplayName ? ` (${data.repo.pathDisplayName})` : ''

    if (data.prs.total > 0 || data.issues.total > 0) {
      content += `\n### ${repoDisplayName}${pathDisplayName}\n`

      // AI 分析 PR 内容
      if (data.prs.total > 0) {
        const prAnalysis = await analyzeWithAI(data.prs.prs.slice(0, 10), 'prs')
        if (prAnalysis) {
          content += `**🔀 PR动向分析**:\n${prAnalysis}\n\n`
        }

        if (data.prs.prs.length > 0) {
          content += `**重要PR** (共${data.prs.total}个，合并${data.prs.merged}个):\n`
          data.prs.prs.slice(0, 10).forEach(pr => {
            content += `- [#${pr.number}](${pr.url}) ${pr.title} - @${pr.user}\n`
          })
          content += `\n`
        }
      }

      // 热门 Issue 分析
      if (data.issues.total > 0) {
        content += `**🔥 本周热门讨论** (按点赞排序):\n`
        data.issues.issues.forEach(issue => {
          content += `${issue.reactions > 0 ? `${issue.reactions}× ` : ''}[#${issue.number}](${issue.url}) ${issue.title} - @${issue.user}\n`
        })
        content += `\n`

        // AI 分析热门 Issue
        const issueAnalysis = await analyzeWithAI(data.issues.issues, 'issues')
        if (issueAnalysis) {
          content += `**🤖 AI 概括分析**:\n${issueAnalysis}\n\n`
        }
      }
    }
  }

  // 结尾
  content += `\n## 📝 本期总结

本周 OpenClaw 生态继续保持活跃发展，共计 **${weeklyData.reduce((acc, data) => acc + data.commits.total, 0)}** 次提交，**${weeklyData.reduce((acc, data) => acc + data.prs.total, 0)}** 个PR，**${weeklyData.reduce((acc, data) => acc + data.issues.total, 0)}** 个Issue（热门讨论见上方）。

---

*本期编辑：PAAS-AIOPS助手 | 数据统计截止：${endStr}* 🦞`

  return content
}

/**
 * 计算周期时间
 */
function getWeekPeriod(weekNumber) {
  // 基准时间：2025年12月29日（星期一）是第1期开始
  // 这样每周都是从周一到周日的完整周
  const baseDate = new Date('2025-12-29')
  const startDate = new Date(baseDate.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000)
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)

  return { start: startDate, end: endDate }
}

/**
 * 主函数
 */
async function main() {
  const weekNumber = process.argv[2] || 1
  console.log(`🚀 开始生成第${weekNumber}期 OpenClaw Weekly... 🦞`)

  // 计算时间范围
  const { start: startDate, end: endDate } = getWeekPeriod(parseInt(weekNumber))
  console.log(`📅 时间范围: ${startDate.toISOString().split('T')[0]} 至 ${endDate.toISOString().split('T')[0]}`)

  // 收集所有仓库数据
  const weeklyData = []
  for (const repo of CONFIG.repos) {
    const data = await getWeeklyData(
      repo.owner,
      repo.name,
      startDate,
      endDate,
      repo.path,
      repo.pathDisplayName
    )
    weeklyData.push(data)

    // 添加延迟避免API限制
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  // 生成周报内容
  const content = await generateWeeklyContent(weeklyData, weekNumber, startDate, endDate)

  // 保存到文件
  const outputPath = path.join(__dirname, '..', 'docs', `${weekNumber.toString().padStart(2, '0')}.md`)
  await fs.writeFile(outputPath, content, 'utf8')

  // 自动更新 VitePress 配置和首页
  await updateVitePressConfig(weekNumber)
  await updateIndexPage(weekNumber)

  console.log(`✅ 第${weekNumber}期周报已生成: ${outputPath}`)
  console.log(`📊 数据统计:`)
  weeklyData.forEach(data => {
    console.log(`  - ${data.repo.name}: ${data.commits.total} commits, ${data.prs.total} PRs, ${data.issues.total} issues`)
  })
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error)
  process.exit(1)
})

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

/**
 * 更新 VitePress 配置文件
 * 自动按月份分组管理侧边栏
 */
async function updateVitePressConfig(weekNumber) {
  const configPath = path.join(__dirname, '..', '.vitepress', 'config.js')

  try {
    // 读取所有现有的周报文件
    const docsPath = path.join(__dirname, '..', 'docs')
    const files = await fs.readdir(docsPath)
    const weeklyFiles = files.filter(file => file.match(/^\d{2}\.md$/))

    // 构建周报列表数据
    const weeklyItems = []
    for (const file of weeklyFiles) {
      const weekNum = parseInt(file.replace('.md', ''))
      const { start, end } = getWeekPeriod(weekNum)

      // 按结束日期确定归属月份
      const endMonth = `${end.getFullYear()}年${end.getMonth() + 1}月`

      const dateRange = formatDateRange(start, end)

      weeklyItems.push({
        weekNumber: weekNum,
        title: `第${weekNum}期：${dateRange}`,
        link: `/docs/${weekNum.toString().padStart(2, '0')}`,
        month: endMonth,
        endDate: end
      })
    }

    // 按月份分组并排序
    const groupedByMonth = {}
    weeklyItems.forEach(item => {
      if (!groupedByMonth[item.month]) {
        groupedByMonth[item.month] = []
      }
      groupedByMonth[item.month].push(item)
    })

    // 每个月内按期数倒序排列
    Object.keys(groupedByMonth).forEach(month => {
      groupedByMonth[month].sort((a, b) => b.weekNumber - a.weekNumber)
    })

    // 月份按时间倒序排列
    const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => {
      const dateA = new Date(a.replace('年', '-').replace('月', '-01'))
      const dateB = new Date(b.replace('年', '-').replace('月', '-01'))
      return dateB - dateA
    })

    // 构建侧边栏配置
    const sidebarConfig = sortedMonths.map(month => ({
      text: month,
      items: groupedByMonth[month].map(item => ({
        text: item.title,
        link: item.link
      }))
    }))

    // 读取配置文件
    const configContent = await fs.readFile(configPath, 'utf8')

    // 手动构建正确的JavaScript对象格式的侧边栏字符串
    let sidebarStr = '[\n'

    sortedMonths.forEach((month, monthIndex) => {
      sidebarStr += '      {\n'
      sidebarStr += `        text: '${month}',\n`
      sidebarStr += '        items: [\n'

      groupedByMonth[month].forEach((item, itemIndex) => {
        sidebarStr += '          {\n'
        sidebarStr += `            text: '${item.title}',\n`
        sidebarStr += `            link: '${item.link}'\n`
        sidebarStr += '          }'

        // 如果不是最后一项，添加逗号
        if (itemIndex < groupedByMonth[month].length - 1) {
          sidebarStr += ','
        }
        sidebarStr += '\n'
      })

      sidebarStr += '        ]\n'
      sidebarStr += '      }'

      // 如果不是最后一个月份，添加逗号
      if (monthIndex < sortedMonths.length - 1) {
        sidebarStr += ','
      }
      sidebarStr += '\n'
    })

    sidebarStr += '    ]'

    // 替换侧边栏配置 - 使用更强的正则表达式匹配整个sidebar数组，包括所有嵌套内容
    const sidebarRegex = /sidebar:\s*\[[\s\S]*?\],/
    let updatedConfig = configContent.replace(sidebarRegex, `sidebar: ${sidebarStr},`)

    // 更新导航栏中的"周报列表"链接到最新一期
    const latestWeekNumber = Math.max(...weeklyItems.map(item => item.weekNumber))
    const navRegex = /(text:\s*'周报列表',\s*link:\s*')[^']*(')/
    updatedConfig = updatedConfig.replace(navRegex, `$1/docs/${latestWeekNumber.toString().padStart(2, '0')}$2`)

    // 保存更新后的配置
    await fs.writeFile(configPath, updatedConfig, 'utf8')
    console.log(`✅ 已自动更新侧边栏配置`)

  } catch (error) {
    console.log('⚠️ 无法自动更新侧边栏配置:', error.message)
  }
}

/**
 * 更新首页内容
 */
async function updateIndexPage(weekNumber) {
  const indexPath = path.join(__dirname, '..', 'index.md')

  try {
    // 读取所有现有的周报文件
    const docsPath = path.join(__dirname, '..', 'docs')
    const files = await fs.readdir(docsPath)
    const weeklyFiles = files.filter(file => file.match(/^\d{2}\.md$/))

    // 构建周报列表数据
    const weeklyItems = []
    for (const file of weeklyFiles) {
      const weekNum = parseInt(file.replace('.md', ''))
      const { start, end } = getWeekPeriod(weekNum)

      // 按结束日期确定归属月份
      const endMonth = `${end.getFullYear()}年${end.getMonth() + 1}月`

      const dateRange = formatDateRange(start, end)

      weeklyItems.push({
        weekNumber: weekNum,
        title: `第${weekNum}期：${dateRange}`,
        link: `/docs/${weekNum.toString().padStart(2, '0')}`,
        month: endMonth,
        endDate: end
      })
    }

    // 按月份分组并排序
    const groupedByMonth = {}
    weeklyItems.forEach(item => {
      if (!groupedByMonth[item.month]) {
        groupedByMonth[item.month] = []
      }
      groupedByMonth[item.month].push(item)
    })

    // 每个月内按期数倒序排列
    Object.keys(groupedByMonth).forEach(month => {
      groupedByMonth[month].sort((a, b) => b.weekNumber - a.weekNumber)
    })

    // 月份按时间倒序排列
    const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => {
      const dateA = new Date(a.replace('年', '-').replace('月', '-01'))
      const dateB = new Date(b.replace('年', '-').replace('月', '-01'))
      return dateB - dateA
    })

    // 构建首页周报列表内容
    let weeklyListContent = '## 📚 周报列表\n\n'

    sortedMonths.forEach(month => {
      weeklyListContent += `### ${month}\n\n`
      groupedByMonth[month].forEach(item => {
        weeklyListContent += `- [${item.title}](${item.link})\n`
      })
      weeklyListContent += '\n'
    })

    weeklyListContent += '\n' // 添加额外空行

    // 读取当前首页内容
    const indexContent = await fs.readFile(indexPath, 'utf8')

    // 删除从"## 📚 周报列表"到"## 🚀 项目特色"之间的所有内容，然后重新插入
    const startMarker = '## 📚 周报列表'
    const endMarker = '## 🚀 项目特色'

    const startIndex = indexContent.indexOf(startMarker)
    const endIndex = indexContent.indexOf(endMarker)

    if (startIndex !== -1 && endIndex !== -1) {
      const beforeContent = indexContent.substring(0, startIndex)
      const afterContent = indexContent.substring(endIndex)
      const updatedContent = beforeContent + weeklyListContent + afterContent

      // 保存更新后的首页
      await fs.writeFile(indexPath, updatedContent, 'utf8')
      console.log(`✅ 已自动更新首页周报列表`)
    } else {
      console.log('⚠️ 无法找到首页更新标记，跳过首页更新')
    }

    return // 提前返回，避免执行下面的旧代码

    // 下面的代码不会执行，但保留以防需要回滚
    const listRegex = /## 📚 周报列表[\s\S]*?(?=## |$)/
    const updatedContentOld = indexContent.replace(listRegex, weeklyListContent)

    // 保存更新后的首页
    await fs.writeFile(indexPath, updatedContentOld, 'utf8')
    console.log(`✅ 已自动更新首页周报列表`)

  } catch (error) {
    console.log('⚠️ 无法自动更新首页:', error.message)
  }
}

/**
 * 格式化日期范围
 */
function formatDateRange(startDate, endDate) {
  const formatDate = (date) => {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}年${month}月${day}日`
  }

  return `${formatDate(startDate)}-${formatDate(endDate)}`
}

export { getWeeklyData, generateWeeklyContent, getWeekPeriod, updateVitePressConfig, updateIndexPage }
