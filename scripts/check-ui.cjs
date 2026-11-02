const { app, BrowserWindow } = require('electron')
const path = require('path'), fs = require('fs'), assert = require('assert/strict')
app.whenReady().then(async () => {
 try {
  fs.mkdirSync(path.join(__dirname, '../.qa'), { recursive: true })
  const win = new BrowserWindow({ show: false, width: 1280, height: 940, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, 'fixtures/ui-preload.cjs') } })
  const errors = []
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message) })
  const js = text => win.webContents.executeJavaScript(text)
  const wait = (ms = 350) => new Promise(resolve => setTimeout(resolve, ms))
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const nav = async index => { await js(`document.querySelectorAll('nav > button')[${index}].click()`); await wait() }
  const shot = async name => fs.writeFileSync(path.join(__dirname, '../.qa', name + '.png'), (await win.webContents.capturePage()).toPNG())
  await win.loadFile(path.join(__dirname, '../dist/index.html')); await wait(700)
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='VI').click()`); await wait()
  assert((await js(`document.querySelector('h1').textContent`)).includes('Máy gọn'))
  await shot('v2-overview')
  await nav(1); assert(await js(`!document.querySelector('.cleanup-category')`))
  await click('.cleanup-empty button'); await wait(500)
  assert.equal(await js(`document.querySelectorAll('.cleanup-category').length`), 2)
  // Reset selection by clicking only if unchecked.
  await js(`document.querySelectorAll('.cleanup-category input').forEach(i=>{if(!i.checked)i.click()})`); await wait()
  await shot('v2-cleanup')
  await click('.cleanup-summary > button'); await wait()
  assert(await js(`document.querySelector('dialog').open`)); assert.equal(await js(`window.muot.testCalls()`), 0)
  await shot('v2-confirmation')
  await click('.preview-footer button:first-child'); await wait(); assert.equal(await js(`window.muot.testCalls()`), 0)
  await click('.cleanup-summary > button'); await wait(); await click('.preview-footer button:last-child'); await wait(600)
  assert.equal(await js(`window.muot.testCalls()`), 1); assert(await js(`!!document.querySelector('.cleanup-category')`))
  await click('.cleanup-summary > button'); await wait(); await click('.preview-footer button:last-child'); await wait(600)
  assert.equal(await js(`window.muot.testCalls()`), 2); assert(await js(`document.querySelector('.cleanup-result').textContent.includes('420')`))
  await shot('v2-results')
  for (const width of [860, 1280]) {
   win.setSize(width, 800); await wait()
   for (let i = 0; i < 7; i++) { await nav(i); assert.equal(await js(`document.documentElement.scrollWidth>innerWidth`), false, `overflow at width ${width} view ${i}`); assert(await js(`!!document.querySelector('h1')`)) }
  }
  await nav(2); await click('[role="switch"]'); await wait(600)
  assert.equal(await js(`document.querySelector('[role="switch"]').getAttribute('aria-checked')`), 'false')
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='EN').click()`); await nav(1)
  assert.equal(await js(`document.querySelector('h1').textContent`), 'Disk cleanup')
  assert.deepEqual(errors, [])
  console.log('Electron UI passed: 7 pages at 860/1280, VI/EN, read-only scan, preview, cancel, final confirmation contract, results, startup regression, no console errors.')
  app.quit()
 } catch (error) { console.error(error); app.exit(1) }
})
