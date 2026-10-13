"""生成 testMd 目录下的二进制与特殊编码测试数据。

生成内容：
  1. img/sample.png        800x400 彩色图，用于验证相对路径图片加载
  2. img/nested/deep.png   400x300，用于验证深层目录相对路径
  3. 09-GBK编码测试.md      GBK 编码，用于验证扩展的编码嗅探兜底
  4. 10-超大文件测试.md     超过 3 MB，用于验证大文件降级提示

用法：
  python scripts/make-testdata.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent.parent / "testMd"


def make_image(path: Path, width: int, height: int, bg: str, label: str) -> None:
    """画一张带边框、圆和文字的图，便于肉眼确认图片真的加载出来了。"""
    path.parent.mkdir(parents=True, exist_ok=True)

    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)

    draw.rectangle([8, 8, width - 8, height - 8], outline="white", width=4)
    draw.ellipse(
        [width // 2 - 70, height // 2 - 70, width // 2 + 70, height // 2 + 70],
        fill="white",
    )
    draw.text((24, 24), label, fill="white")
    draw.text((24, height - 40), f"{width}x{height}", fill="white")

    img.save(path, "PNG")


def make_gbk_doc(path: Path) -> None:
    """GBK 编码的中文 Markdown。

    Chrome 对无 charset 声明的本地文件默认按 UTF-8 解码，
    这个文件因此会显示为乱码——除非扩展通过 Service Worker
    重新以 GBK 解码（见 src/background.ts 的 decodeSmart）。
    """
    lines = [
        "# GBK 编码测试文档",
        "",
        "本文件以 **GBK（GB2312 超集）** 编码保存，不是 UTF-8。",
        "",
        "## 验证方法",
        "",
        "如果页面上的中文全部正常显示，说明扩展的编码嗅探兜底生效了。",
        "如果看到大量「锟斤拷」或「」这样的替换字符，说明兜底没有生效。",
        "",
        "## 中文内容样本",
        "",
        "数据仓库的分层架构通常包含贴源层、明细层、汇总层和应用层。",
        "评论数据从多个来源系统汇聚，经过清洗与标准化后形成统一视图。",
        "",
        "特殊标点测试：顿号、分号；冒号：问号？感叹号！省略号……破折号——",
        "",
        "## 表格",
        "",
        "| 字段 | 类型 | 说明 |",
        "| --- | --- | --- |",
        "| review_id | bigint | 评论主键 |",
        "| rating | decimal | 用户评分 |",
        "| topic_name | varchar | 主题名称 |",
        "",
        "## 代码块",
        "",
        "```sql",
        "SELECT review_id, rating FROM mv_voc WHERE rating >= 4.0;",
        "```",
        "",
        "## 列表",
        "",
        "- 第一条：数据接入",
        "- 第二条：字段映射",
        "- 第三条：增量同步",
        "",
        "> 引用块中的中文同样需要正确解码。",
        "",
        "## 常见 GBK 字符",
        "",
        "镕 燊 喆 昇 堃 淼 焱 垚 犇 骉 羴 猋 麤 龘",
        "",
        "（这些生僻字在 GBK 中有编码，UTF-8 解码会失败，是很好的判定样本）",
        "",
    ]

    path.write_text("\n".join(lines), encoding="gbk")
    print(f"  写入 GBK 文件，共 {len('\n'.join(lines).encode('gbk'))} 字节")


def make_huge_doc(path: Path, target_mb: float = 3.3) -> None:
    """生成超过 3 MB 的 Markdown，触发扩展的降级逻辑。"""
    target_bytes = int(target_mb * 1024 * 1024)

    parts = [
        "# 超大文件测试文档",
        "",
        "本文件超过 3 MB，用于验证扩展的大文件降级提示。",
        "",
        "**预期行为**：顶部出现黄色提示条，页面保持原始纯文本，不做渲染。",
        "",
        "---",
        "",
    ]

    size = len("".join(parts).encode("utf-8"))
    index = 1

    while size < target_bytes:
        section = (
            f"## 章节 {index:05d}\n"
            f"\n"
            f"这是第 {index} 个章节的正文内容。它的唯一用途是把文件体积撑到 3 MB 以上，"
            f"以便验证扩展在遇到超大文件时不会卡死标签页，而是给出明确提示。\n"
            f"\n"
            f"| 字段 | 值 |\n"
            f"| --- | --- |\n"
            f"| 序号 | {index} |\n"
            f"| 状态 | 占位内容 |\n"
            f"\n"
        )
        parts.append(section)
        size += len(section.encode("utf-8"))
        index += 1

    text = "".join(parts)
    path.write_text(text, encoding="utf-8")
    print(f"  写入大文件：{index - 1} 个章节，{size / 1024 / 1024:.2f} MB")


def main() -> None:
    print(f"输出目录：{BASE}")

    print("[1/4] sample.png")
    make_image(BASE / "img" / "sample.png", 800, 400, "#2f6f4e", "Markdown Read sample image")

    print("[2/4] nested/deep.png")
    make_image(BASE / "img" / "nested" / "deep.png", 400, 300, "#8a4b2a", "nested/deep.png")

    print("[3/4] 09-GBK编码测试.md")
    make_gbk_doc(BASE / "09-GBK编码测试.md")

    print("[4/4] 10-超大文件测试.md")
    make_huge_doc(BASE / "10-超大文件测试.md")

    print("完成。")


if __name__ == "__main__":
    main()
