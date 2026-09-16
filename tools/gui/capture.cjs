const { app, desktopCapturer, screen } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

/**
 * 抓指定窗口，输出 PNG。
 *
 * 为什么要按真实尺寸抓：desktopCapturer 会把缩略图缩放到你要求的尺寸
 * （实测：窗口 1941x1215，请求 3840x2400 就得到一张 1.975 倍的上采样图）。
 * 抓成 1:1 之后，截图上量到的像素坐标 = 窗口内坐标，可以拿去点。
 *
 * 用法：
 *   electron capture.cjs <outDir> <标题子串> <宽> <高> [输出文件名]
 */

const [outDir, only = 'Termius', reqW = '1941', reqH = '1215', outName = 'live'] = process.argv.slice(2)

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true })

  const sources = await desktopCapturer.getSources({
    types: only.startsWith('@screen') ? ['screen'] : ['window'],
    thumbnailSize: { width: Number(reqW), height: Number(reqH) },
    fetchWindowIcons: false,
  })

  // 原生弹出菜单（#32768 那类）不属于任何应用窗口，只能靠整屏截图看到
  const hits = only.startsWith('@screen')
    ? sources
    : sources.filter((s) => s.name.toLowerCase().includes(only.toLowerCase()))
  if (!hits.length) {
    console.log(`没找到标题含「${only}」的窗口。现有：${sources.map((s) => s.name).join(' | ')}`)
    app.quit()
    return
  }

  const target = hits.sort((a, b) => b.thumbnail.getSize().width - a.thumbnail.getSize().width)[0]
  const size = target.thumbnail.getSize()
  const file = join(outDir, `${outName}.png`)
  writeFileSync(file, target.thumbnail.toPNG())
  console.log(`抓到「${target.name}」 ${size.width}x${size.height} → ${file}`)
  console.log(`显示：${screen.getPrimaryDisplay().size.width}x${screen.getPrimaryDisplay().size.height}`)
  app.quit()
})
