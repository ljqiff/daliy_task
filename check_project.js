/**
 * 博大新元青年人才项目状态检查器
 * 每小时运行一次，检查就业青年人才项目是否有空位
 *
 * 使用方式:
 *   node check_project.js              # 单次检查
 *   node check_project.js --headless   # 定时模式（输出 JSON）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const CONFIG = {
  siteUrl: 'http://dxs.bdalife.cn:4443/?v=1778084022796#/',
  stateFile: path.join(__dirname, '.auth_state.json'),
  resultFile: path.join(__dirname, 'project_status.json'),
  prevResultFile: path.join(__dirname, 'project_status_prev.json'),
  screenshotDir: path.join(__dirname, 'screenshots'),
  timeout: 60000,
  cronOutputFile: path.join(__dirname, 'cron_output.json'),
};

fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });

// ========== 工具函数 ==========
const timestamp = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const log = (msg, lvl = 'INFO') => console.log(`[${timestamp()}] [${lvl}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadState() {
  try { return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8')); }
  catch { return null; }
}

function saveState(state) {
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state), 'utf-8');
}

function saveResult(data) {
  // Save previous result if exists
  if (fs.existsSync(CONFIG.resultFile)) {
    fs.copyFileSync(CONFIG.resultFile, CONFIG.prevResultFile);
  }
  fs.writeFileSync(CONFIG.resultFile, JSON.stringify(data, null, 2), 'utf-8');
}

function loadPrevResult() {
  try { return JSON.parse(fs.readFileSync(CONFIG.prevResultFile, 'utf-8')); }
  catch { return null; }
}

function compareResults(prev, curr) {
  if (!prev) return { changed: true, reason: '首次检查' };
  if (JSON.stringify(prev.projects) !== JSON.stringify(curr.projects)) {
    const changes = [];
    for (let i = 0; i < Math.max(prev.projects.length, curr.projects.length); i++) {
      const p = prev.projects[i], c = curr.projects[i];
      if (!p || !c || p.status !== c.status) {
        changes.push({
          name: c?.name || p?.name,
          prev: p?.status || '不存在',
          curr: c?.status || '不存在'
        });
      }
    }
    return { changed: true, reason: '项目状态变化', details: changes };
  }
  return { changed: false, reason: '无变化' };
}

// ========== 核心流程 ==========
async function checkProjects(headless) {
  const state = loadState();
  if (!state) {
    const err = { success: false, error: '无已保存的登录会话，请先运行 setup' };
    if (headless) fs.writeFileSync(CONFIG.cronOutputFile, JSON.stringify(err));
    throw new Error(err.error);
  }

  log('加载已保存的会话');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    storageState: state,
  });
  const page = await context.newPage();

  // Dismiss any alert dialogs
  page.on('dialog', async d => { await d.dismiss(); });

  // Check if session still valid
  let sessionValid = false;
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/customer/customer/applet/get_customer_info')) {
      sessionValid = resp.status() === 200;
    }
  });

  try {
    // === Step 1: 首页 ===
    log('Step 1: 打开首页');
    await page.goto(CONFIG.siteUrl, { waitUntil: 'networkidle', timeout: 20000 });
    await sleep(2000);

    // === Step 2: 点击申请 ===
    log("Step 2: 点击「申请」");
    // Dismiss any masks first
    await page.evaluate(() => {
      document.querySelectorAll('.uni-mask, [class*="mask"]').forEach(m => m.remove());
    }).catch(() => {});
    await sleep(500);
    await page.getByText('申请').first().click({ force: true, timeout: 10000 });
    await sleep(2000);

    const pageText1 = await page.evaluate(() => document.body?.innerText?.substring(0, 200));
    if (!pageText1.includes('人才类型选择')) {
      log('会话可能已过期，需要重新登录', 'ERROR');
      if (headless) {
        fs.writeFileSync(CONFIG.cronOutputFile, JSON.stringify({
          success: false, error: 'SESSION_EXPIRED', message: '登录会话已过期，需要重新运行 --setup'
        }));
      }
      throw new Error('SESSION_EXPIRED');
    }

    // === Step 3: 选择就业青年人才 ===
    log('Step 3: 选择「就业青年人才」');
    // Remove mask again before clicking
    await page.evaluate(() => {
      document.querySelectorAll('.uni-mask, [class*="mask"]').forEach(m => m.remove());
    }).catch(() => {});
    await sleep(300);
    await page.getByText('就业青年人才').click({ force: true, timeout: 10000 });
    await sleep(500);

    // === Step 4: 点击确定 ===
    log('Step 4: 点击「确定」');
    await page.getByText('确定').first().click({ force: true, timeout: 10000 });
    await sleep(3000);

    // === Step 5: 处理弹窗 ===
    // 弹窗1: 实名认证提示 → 点取消
    let cancelBtn = page.locator('text=取消').last();
    if (await cancelBtn.count() > 0) {
      log('Step 5a: 关闭实名认证弹窗');
      await cancelBtn.click({ force: true, timeout: 5000 });
      await sleep(1000);
    }
    // 弹窗2: 开放时间提示(08:00-20:00以外) → 点确定
    let timeModalBtn = page.locator('.uni-modal__btn').last();
    if (await timeModalBtn.count() > 0) {
      const timeText = await page.evaluate(() => {
        const modal = document.querySelector('.uni-modal__bd');
        return modal?.textContent?.trim() || '';
      });
      log(`Step 5b: 关闭时间提示弹窗: ${timeText}`);
      await timeModalBtn.click({ force: true, timeout: 5000 });
      await sleep(1000);
    }

    // === Step 6: 等待阅读倒计时 ===
    log('Step 6: 等待阅读倒计时...');
    let countdownDone = false;
    let closedHours = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const btnText = await page.evaluate(() => {
        const btn = document.querySelector('[class*="footer-btn"]');
        return btn?.textContent?.trim() || '';
      });
      
      if (btnText === '已阅读，开始申请') {
        log('倒计时完成，点击「已阅读，开始申请」');
        await page.locator('[class*="footer-btn"]').first().click({ force: true });
        await sleep(3000);
        countdownDone = true;
        break;
      }
      // If still showing talent selection page, closed hours
      if (btnText === '确定' && i > 10) {
        closedHours = true;
        log('系统未开放（08:00-20:00），跳过本次检查', 'WARN');
        break;
      }
      if (i % 5 === 0) log(`  等待中... (${btnText || '加载中'})`);
    }

    if (closedHours) {
      if (headless) {
        fs.writeFileSync(CONFIG.cronOutputFile, JSON.stringify({
          success: true, status: 'CLOSED_HOURS', available: false,
          message: '系统开放时间 08:00-20:00', time: new Date().toISOString()
        }, null, 2));
      }
      // Save updated session anyway
      const newState = await context.storageState();
      saveState(newState);
      return { allFull: true, projects: [], note: '系统未开放' };
    }

    if (!countdownDone) {
      throw new Error('倒计时超时，未能进入申请页面');
    }

    // === Step 7: 点击意向入住项目 ===
    log('Step 7: 打开项目选择器');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);

    const projectField = page.locator('text=请选择意向入住项目').first();
    if (await projectField.count() === 0) {
      throw new Error('未找到「意向入住项目」选择器');
    }
    await projectField.click({ force: true });
    await sleep(2000);

    // === Step 8: 提取项目列表 ===
    log('Step 8: 提取项目状态');
    const projectItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.tui-picker__item'))
        .map(el => {
          const text = el.textContent?.trim() || '';
          const isFull = text.includes('已满');
          const name = text.replace(/\(已满\)/g, '').trim();
          return { name, status: isFull ? '已满' : '可申请' };
        })
        .filter(p => p.name.length > 0);
    });

    if (projectItems.length === 0) {
      log('未提取到项目数据，检查页面截图', 'WARN');
      await page.screenshot({ path: path.join(CONFIG.screenshotDir, 'debug.png'), fullPage: true });
      throw new Error('未提取到项目列表数据');
    }

    // === Step 9: 保存结果 ===
    const result = {
      checkTime: new Date().toISOString(),
      checkTimeLocal: timestamp(),
      projects: projectItems,
      totalCount: projectItems.length,
      fullCount: projectItems.filter(p => p.status === '已满').length,
      availableCount: projectItems.filter(p => p.status !== '已满').length,
      allFull: projectItems.every(p => p.status === '已满'),
    };

    // Compare with previous
    const prevResult = loadPrevResult();
    const comparison = compareResults(prevResult, result);
    result.comparison = comparison;

    saveResult(result);

    // Screenshot for record
    const screenshotPath = path.join(CONFIG.screenshotDir, `check_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // === Step 10: 输出结果 ===
    log('\n========== 检查结果 ==========');
    result.projects.forEach(p => {
      const icon = p.status === '已满' ? '🔴' : '🟢';
      log(`${icon} ${p.name} - ${p.status}`);
    });
    log(`共 ${result.totalCount} 个项目，${result.availableCount} 个可申请，${result.fullCount} 个已满`);

    if (result.allFull) {
      log('所有项目均已满 ⚠️');
    } else {
      log('⚠️⚠️⚠️ 有项目可申请！⚠️⚠️⚠️', 'WARN');
    }

    if (comparison.changed) {
      log(`状态变化: ${comparison.reason}`, 'WARN');
    }

    // Save session (cookies/tokens may have been refreshed)
    const newState = await context.storageState();
    saveState(newState);

    // Cron output
    if (headless) {
      const output = {
        success: true,
        status: result.allFull ? 'ALL_FULL' : 'HAS_AVAILABLE',
        available: result.availableCount > 0,
        projects: result.projects,
        comparison,
        checkTime: result.checkTime,
        screenshot: screenshotPath,
      };
      fs.writeFileSync(CONFIG.cronOutputFile, JSON.stringify(output, null, 2));
    }

    return result;

  } catch (e) {
    log(`错误: ${e.message}`, 'ERROR');
    await page.screenshot({
      path: path.join(CONFIG.screenshotDir, `error_${Date.now()}.png`),
      fullPage: true,
    }).catch(() => {});
    
    if (headless) {
      fs.writeFileSync(CONFIG.cronOutputFile, JSON.stringify({
        success: false,
        error: e.message,
        time: new Date().toISOString(),
      }, null, 2));
    }
    throw e;
  } finally {
    await browser.close();
  }
}

// ========== 入口 ==========
(async () => {
  const headless = process.argv.includes('--headless');
  try {
    const result = await checkProjects(headless);
    process.exit(result.allFull ? 0 : 1);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(2);
  }
})();
