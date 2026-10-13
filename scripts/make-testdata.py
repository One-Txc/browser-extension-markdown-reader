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

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent.parent / "testMd"


def make_demo_image(
    path: Path,
    width: int,
    height: int,
    start: tuple[int, int, int],
    end: tuple[int, int, int],
    number: str,
    caption: str,
) -> None:
    """生成演示用图片：对角渐变底 + 大编号 + 底部说明。

    专供 testMd/11-综合示例.md 的截图使用 —— 那张图要干净、好看，
    不能像 make_image 那样只有白框白圆（那是给自动化测试看的）。

    字体优先用系统里的中文字体，取不到就退回默认位图字体（只影响文字观感，
    不影响生成成功）。所以这里的文字用中英混排时要留意：默认字体画不出中文，
    会显示成方块，真出现那种情况说明字体没加载上。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)

    # 对角渐变：按 (x+y) 的占比在两端颜色之间插值
    span = (width - 1) + (height - 1)
    for y in range(height):
        for x in range(0, width, 2):  # 每次画两列，肉眼无差别但快一倍
            t = (x + y) / span
            color = tuple(round(s + (e - s) * t) for s, e in zip(start, end))
            draw.line([(x, y), (min(x + 1, width - 1), y)], fill=color)

    def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
        for name in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "arial.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                continue
        return ImageFont.load_default()

    big = load_font(int(height * 0.42))
    small = load_font(int(height * 0.065))

    # 大编号居中（用 anchor="mm" 省去手工测量宽高）
    draw.text((width / 2, height * 0.46), number, fill="white", font=big, anchor="mm")

    # 底部说明，带一点半透明压暗，保证在任何底色上都看得清
    bar_h = int(height * 0.13)
    bar = Image.new("RGBA", (width, bar_h), (0, 0, 0, 90))
    img.paste(Image.alpha_composite(
        img.crop((0, height - bar_h, width, height)).convert("RGBA"), bar
    ).convert("RGB"), (0, height - bar_h))

    draw.text((width / 2, height - bar_h / 2), caption, fill="white", font=small, anchor="mm")

    img.save(path, "PNG")


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

    print("[1/5] sample.png")
    make_image(BASE / "img" / "sample.png", 800, 400, "#2f6f4e", "Markdown Read sample image")

    print("[2/5] nested/deep.png")
    make_image(BASE / "img" / "nested" / "deep.png", 400, 300, "#8a4b2a", "nested/deep.png")

    # 演示图：11-综合示例.md 里用来展示「点击放大 + 上一张/下一张」
    print("[3/5] img/demo-1~3.png")
    demos = [
        ("demo-1.png", (79, 70, 229), (147, 51, 234), "1", "渐变色卡 · 第一张"),
        ("demo-2.png", (13, 148, 136), (59, 130, 246), "2", "渐变色卡 · 第二张"),
        ("demo-3.png", (234, 88, 12), (219, 39, 119), "3", "渐变色卡 · 第三张"),
    ]
    for name, start, end, number, caption in demos:
        make_demo_image(BASE / "img" / name, 960, 540, start, end, number, caption)

    print("[4/5] 09-GBK编码测试.md")
    make_gbk_doc(BASE / "09-GBK编码测试.md")

    print("[5/5] 10-超大文件测试.md")
    make_huge_doc(BASE / "10-超大文件测试.md")

    print("完成。")


if __name__ == "__main__":
    main()
