# Mermaid 图表测试

> ⚠️ Mermaid 打包后有约 5 MB，只在页面真的出现 ` ```mermaid ` 时才注入，
> 所以**首次打开本文件会有 1 秒左右的延迟**，图表随后才出现。
> 这是预期行为。

## 流程图

```mermaid
graph TD
  A[用户打开 .md] --> B{content script 是否注入}
  B -->|是| C[读取 body > pre 原文]
  B -->|否| D[提示开启文件访问权限]
  C --> E[markdown-it 渲染]
  E --> F[DOMPurify 消毒]
  F --> G[替换 body]
  G --> H{是否含 mermaid}
  H -->|是| I[按需注入 Mermaid]
  H -->|否| J[完成]
  I --> J
```

## 时序图

```mermaid
sequenceDiagram
  participant U as 用户
  participant C as Content Script
  participant S as Service Worker
  U->>C: 打开 file:///doc.md
  C->>C: 读取 body > pre
  Note over C: DOM 读取失败时
  C->>S: read-file
  S-->>C: 文本内容（含编码嗅探）
  C->>U: 渲染后的文档
```

## 类图

```mermaid
classDiagram
  class Review {
    +int review_id
    +float rating
    +str text
    +summary() str
  }
  class Topic {
    +str topic_name
    +int count
  }
  Review "1" --> "*" Topic : 包含
```

## ER 图

```mermaid
erDiagram
  MV_VOC ||--o{ FACT_VOC_TOPIC : "review_id"
  MV_VOC {
    bigint review_id PK
    decimal rating
    string moderation_status
  }
  FACT_VOC_TOPIC {
    bigint review_id FK
    string topic_name
  }
```

## 状态图

```mermaid
stateDiagram-v2
  [*] --> 待审核
  待审核 --> 审核通过 : 人工通过
  待审核 --> 审核拒绝 : 违规内容
  审核通过 --> 已删除 : 用户删除
  审核拒绝 --> [*]
  已删除 --> [*]
```

## 甘特图

```mermaid
gantt
  title 项目排期
  dateFormat YYYY-MM-DD
  section 数据接入
  对接 Gold 层      :done, a1, 2026-05-01, 10d
  字段映射          :done, a2, after a1, 7d
  section 指标建设
  口径确认          :active, b1, 2026-06-01, 14d
  回刷历史数据      :b2, after b1, 20d
```

## 饼图

```mermaid
pie title 评论来源占比
  "电商评论" : 42
  "客服工单" : 28
  "问卷反馈" : 18
  "社媒监听" : 12
```

## 思维导图

```mermaid
mindmap
  root((MD Reader))
    渲染
      markdown-it
      DOMPurify
      highlight.js
    主题
      浅色
      深色
    增强
      KaTeX
      Mermaid
```

## 故意写错的图表（应该降级为原始代码而不是崩溃）

```mermaid
graph TD
  A --> --> B
  这不是合法的 mermaid 语法
```

上面这段渲染失败后，应当保留原始代码文本并带上提示色，页面不应白屏。

## 图表与其它内容混排

图表前面有文字。

```mermaid
graph LR
  A[原始 Markdown] --> B[渲染结果]
```

图表后面也有文字，说明块级元素的间距是否正常。

| 图表类型 | 是否支持 |
| --- | --- |
| flowchart | ✅ |
| sequence | ✅ |
| class / ER / state | ✅ |
| gantt / pie / mindmap | ✅ |
