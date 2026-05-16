/**
 * 定时检查博大新元青年人才项目状态
 * 
 * 流程：
 * 1. 手机号登录（自动识别图形验证码）
 * 2. 输入短信验证码（交互式）
 * 3. 选择"就业青年人才"
 * 4. 确认后等待15s阅读指南
 * 5. 查看申请项目列表
 * 6. 检查是否满员
 * 7. 保存结果并通知
 *
 * 首次使用: node check_project.js --setup     # 交互式登录并保存会话
 * 定时运行: node check_project.js --headless  # 使用已保存的会话
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createWorker } = require('tesseract.js');

// ========== 配置 ==========
const CONFIG = {
  siteUrl: 'http://dxs.bdalife.cn:4443/?v=1778084022796#/',
  stateFile: path.join(__dirname, '.auth_state.json'),
  configFile: path.join(__dirname, 'config.json'),
  resultFile: path.join(__dirname, 'project_status.json'),
  screenshotDir: path.join(__dirname, 'screenshots'),
  studentType: '就业青年人才',
  studentTypeValue: 'GC0060003',
  guideWaitTime: 15000,
};

// 确保目录存在
if (!fs.existsSync(CONFIG.screenshotDir)) {
  fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
}

// ========== 工具函数 ==========
function log(msg, level = 'INFO') {
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const prefix = { INFO: '📋', WARN: '⚠️', ERROR: '❌', SUCCESS: '✅', ACTION: '🔧' }[level] || '  ';
  console.log(`[${time}] ${prefix} ${msg}`);
}

function loadConfig() {
  if (fs.existsSync(CONFIG.configFile)) {
    return JSON.parse(fs.readFileSync(CONFIG.configFile, 'utf-8'));
  }
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG.configFile, JSON.stringify(config, null, 2), 'utf-8');
}

async function saveSession(context) {
  const state = await context.storageState();
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  log('会话已保存', 'SUCCESS');
}

async function loadSession() {
  if (fs.existsSync(CONFIG.stateFile)) {
    log('加载已保存的会话...');
    return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8'));
  }
  return null;
}

async function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ========== 登录流程 ==========
async function doLogin(page, context) {
  const config = loadConfig();
  let phone = config.phone;

  // Step 1: 获取手机号
  if (!phone) {
    phone = await askQuestion('请输入手机号: ');
    saveConfig({ phone });
  }
  log(`使用手机号: ${phone}`);

  // Step 2: 导航到登录页
  log('导航到登录页...');
  await page.goto(CONFIG.siteUrl + 'pages/login/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // 检查是否已登录
  const currentUrl = page.url();
  if (!currentUrl.includes('login')) {
    log('已经处于登录状态，跳过登录', 'SUCCESS');
    return true;
  }

  // Step 3: 输入手机号
  log('输入手机号...');
  const phoneInput = page.locator('input[type="number"], input[placeholder*="手机"], input').first();
  await phoneInput.click();
  await phoneInput.fill(phone);
  await page.waitForTimeout(500);

  // Step 4: 处理图形验证码
  log('获取图形验证码...');
  
  // 查找并点击获取验证码的区域来触发图形验证码显示
  const captchaTriggers = [
    page.getByText('获取验证码'),
    page.getByText('发送验证码'),
    page.locator('[class*="vcode"] button'),
    page.locator('[class*="vcode"]'),
    page.locator('text=图形验证码'),
  ];

  // 先尝试点击输入手机号后的区域来触发验证码
  await page.waitForTimeout(1000);

  let captchaSolved = false;
  let captchaCode = '';

  // 查找验证码图片
  const captchaImg = page.locator('img[class*="vcode"], canvas[class*="vcode"], [class*="captcha"] img, img[src*="captcha"], img[src*="code"]');
  
  const captchaCount = await captchaImg.count();
  log(`找到 ${captchaCount} 个验证码图片`);

  if (captchaCount > 0) {
    // 截图并尝试 OCR
    const captchaPath = path.join(CONFIG.screenshotDir, 'captcha.png');
    await captchaImg.first().screenshot({ path: captchaPath });
    log(`验证码已保存到: ${captchaPath}`, 'ACTION');

    // 尝试用 tesseract.js OCR
    try {
      log('正在进行 OCR 识别...');
      const worker = await createWorker('eng');
      const { data: { text } } = await worker.recognize(captchaPath);
      await worker.terminate();
      
      if (text && text.trim().length >= 2) {
        captchaCode = text.trim().replace(/[^a-zA-Z0-9]/g, '');
        log(`OCR 识别结果: "${captchaCode}"`, 'INFO');
        
        const useOcr = await askQuestion('使用 OCR 结果？(y/n/手动输入): ');
        if (useOcr.toLowerCase() === 'y') {
          captchaSolved = true;
        }
      } else {
        log('OCR 未识别到有效验证码', 'WARN');
      }
    } catch (e) {
      log(`OCR 出错: ${e.message}，请手动输入`, 'WARN');
    }

    if (!captchaSolved) {
      log('请查看截图文件: ' + captchaPath, 'ACTION');
      captchaCode = await askQuestion('请输入图形验证码: ');
    }

    // 填入验证码
    const captchaInput = page.locator('input[placeholder*="图形"], input[placeholder*="验证码"]').first();
    const captchaInputCount = await captchaInput.count();
    if (captchaInputCount > 0) {
      await captchaInput.click();
      await captchaInput.fill(captchaCode);
      log('图形验证码已填入', 'SUCCESS');
    }
  } else {
    log('未找到图形验证码，可能无需验证码', 'INFO');
  }

  // Step 5: 获取短信验证码
  await page.waitForTimeout(500);
  
  // 点击获取短信验证码
  const smsBtn = page.locator('button:has-text("获取"), text=获取验证码, [class*="vcode"] button').first();
  if (await smsBtn.count() > 0) {
    await smsBtn.click();
    log('已请求短信验证码', 'SUCCESS');
  }

  const smsCode = await askQuestion('请输入短信验证码: ');

  // 填入短信验证码
  const smsInput = page.locator('input[placeholder*="短信"], input[placeholder*="验证码"]').last();
  if (await smsInput.count() > 0) {
    await smsInput.click();
    await smsInput.fill(smsCode);
    log('短信验证码已填入', 'SUCCESS');
  }

  // Step 6: 点击登录按钮
  log('点击登录...');
  const loginBtn = page.locator('button:has-text("登录"), button:has-text("注册"), text=登录, text=注册/登录').first();
  if (await loginBtn.count() > 0) {
    await loginBtn.click();
  }

  // 等待登录完成
  await page.waitForTimeout(3000);
  
  const finalUrl = page.url();
  log(`登录后 URL: ${finalUrl}`);

  if (finalUrl.includes('login')) {
    log('登录可能失败，请检查验证码', 'ERROR');
    return false;
  }

  log('登录成功！', 'SUCCESS');
  await saveSession(context);
  return true;
}

// ========== 检查项目流程 ==========
async function checkProjects(page) {
  // Step 1: 导航到首页
  log('导航到首页...');
  await page.goto(CONFIG.siteUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Step 2: 点击"申请"
  log('点击"申请"...');
  const applyTab = page.getByText('申请').first();
  if (await applyTab.count() === 0) {
    log('未找到"申请"入口', 'ERROR');
    return null;
  }
  await applyTab.click();
  await page.waitForTimeout(2000);

  // Step 3: 选择"就业青年人才"
  log(`选择"${CONFIG.studentType}"...`);
  const studentOption = page.getByText(CONFIG.studentType);
  if (await studentOption.count() > 0) {
    await studentOption.click();
    await page.waitForTimeout(500);
  }

  // Step 4: 点击"确定"
  log('点击"确定"...');
  const confirmBtn = page.getByText('确定');
  if (await confirmBtn.count() > 0) {
    await confirmBtn.click();
    await page.waitForTimeout(2000);
  }

  // 检查是否有弹窗
  const modal = page.locator('[class*="tui-modal"], [class*="modal"]');
  if (await modal.count() > 0) {
    const modalText = await modal.first().textContent();
    log(`检测到弹窗: ${modalText?.substring(0, 100)}`, 'WARN');
    
    // 尝试关闭弹窗或点击"去认证"等按钮
    const goVerifyBtn = page.getByText('去认证');
    if (await goVerifyBtn.count() > 0) {
      log('需要实名认证，点击"去认证"...');
      await goVerifyBtn.click();
      await page.waitForTimeout(2000);
    }
  }

  // Step 5: 等待跳转到项目列表页
  log(`等待 ${CONFIG.guideWaitTime / 1000}s...`);
  
  // 监听 URL 变化
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    
    // 检查是否到了项目页
    if (url.includes('pages/my/apply/project') || url.includes('application')) {
      log(`已跳转到项目页面: ${url}`, 'SUCCESS');
      break;
    }
    
    // 检查页面内容是否有项目列表
    const hasProjects = await page.locator('text=项目介绍, text=项目名称').count();
    if (hasProjects > 0) {
      log('检测到项目列表内容', 'SUCCESS');
      break;
    }
  }

  // Step 6: 截图并提取信息
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const screenshotPath = path.join(CONFIG.screenshotDir, `project_${timestamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  log(`截图已保存: ${screenshotPath}`);

  // 提取页面文本
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  
  // 分析项目状态
  const projects = [];
  const lines = bodyText.split('\n').filter(l => l.trim());
  
  // 常见的项目名称模式
  const projectKeywords = ['亦嘉', '台湖', '南海', '亦城', '科创', '公寓', '家园'];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (projectKeywords.some(kw => line.includes(kw))) {
      // 获取上下文（前后各一行）
      const context = lines.slice(Math.max(0, i-1), Math.min(lines.length, i+3)).join(' | ');
      const hasFull = /满|已满|无房|售罄|已选完|不可选|已结束/i.test(context);
      projects.push({
        name: line,
        context: context.substring(0, 200),
        status: hasFull ? '已满' : '可申请',
      });
    }
  }

  // 也检查是否有"剩余"等关键词
  const availabilityPatterns = [
    /剩余\s*(\d+)\s*套/gi,
    /可申请/gi,
    /已满/gi,
    /(\d+)\/(\d+)/g, // 如 3/10 表示已用/总数
  ];

  const result = {
    checkTime: new Date().toISOString(),
    url: page.url(),
    projects,
    fullText: bodyText.substring(0, 5000),
    screenshot: screenshotPath,
    hasFullProjects: projects.some(p => p.status === '已满'),
    availableProjects: projects.filter(p => p.status !== '已满').length,
    totalProjects: projects.length,
  };

  fs.writeFileSync(CONFIG.resultFile, JSON.stringify(result, null, 2), 'utf-8');
  log('结果已保存', 'SUCCESS');

  return result;
}

function generateNotification(result) {
  if (!result) return '检查失败，请查看日志';

  const date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const time = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  let msg = `📋 博大新元项目检查 - ${date} ${time}\n\n`;

  if (result.projects.length === 0) {
    msg += '⚠️ 未能提取到项目信息，可能是页面结构变化\n';
    msg += '请查看完整截图\n';
  } else {
    msg += `共发现 ${result.totalProjects} 个项目:\n\n`;
    result.projects.forEach(p => {
      const icon = p.status === '已满' ? '🔴' : '🟢';
      msg += `${icon} ${p.name} - ${p.status}\n`;
    });

    if (result.hasFullProjects) {
      msg += `\n⚠️ 有项目已满！`;
    } else {
      msg += `\n✅ 所有项目均可申请`;
    }
  }

  return msg;
}

// ========== 主流程 ==========
async function main() {
  const args = process.argv.slice(2);
  const isSetup = args.includes('--setup');
  const isHeadless = args.includes('--headless');

  log(`模式: ${isSetup ? '首次设置' : isHeadless ? '后台检查' : '交互模式'}`);

  const browser = await chromium.launch({
    headless: isHeadless || !isSetup,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let savedState = null;
  if (!isSetup) {
    savedState = await loadSession();
    if (!savedState) {
      log('无已保存会话，请先运行 node check_project.js --setup', 'ERROR');
      await browser.close();
      process.exit(1);
    }
  }

  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    ignoreHTTPSErrors: true,
    ...(savedState ? { storageState: savedState } : {}),
  });

  const page = await context.newPage();

  try {
    // 登录
    if (isSetup) {
      const loginSuccess = await doLogin(page, context);
      if (!loginSuccess) {
        log('登录失败，请重试', 'ERROR');
        await browser.close();
        process.exit(1);
      }
    }

    // 检查项目
    const result = await checkProjects(page);
    const notification = generateNotification(result);
    
    log('\n========== 检查结果 ==========');
    console.log(notification);
    log('===============================');

    // 保存通知消息
    fs.writeFileSync(path.join(__dirname, 'notification.txt'), notification, 'utf-8');

    // 如果是 headless 模式（定时任务），输出 JSON 格式供解析
    if (isHeadless && result) {
      const output = {
        success: true,
        notification,
        result,
      };
      fs.writeFileSync(path.join(__dirname, 'cron_output.json'), JSON.stringify(output, null, 2), 'utf-8');
    }

    await saveSession(context);

  } catch (e) {
    log(`执行出错: ${e.message}`, 'ERROR');
    console.error(e.stack);
    
    if (isHeadless) {
      fs.writeFileSync(path.join(__dirname, 'cron_output.json'), JSON.stringify({
        success: false,
        error: e.message,
      }, null, 2), 'utf-8');
    }
  } finally {
    await browser.close();
    log('浏览器已关闭');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
