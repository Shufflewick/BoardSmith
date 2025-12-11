import puppeteer from 'puppeteer';

const URL = 'http://localhost:5173/game/j3ocbrz7/0';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function debug() {
  const browser = await puppeteer.launch({ headless: false, devtools: true });
  const page = await browser.newPage();

  // Collect console logs
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('[DebugPanel]')) {
      console.log('CONSOLE:', text);
    }
  });

  console.log('Navigating to:', URL);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Press 'D' to open debug panel
  console.log('\n=== Opening Debug Panel with D key ===');
  await page.keyboard.press('d');
  await sleep(1000);

  // Check all tab buttons - they are in .debug-tabs
  console.log('\n=== Tab buttons (in .debug-tabs) ===');
  const tabsInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.debug-tabs button'));
    return buttons.map(b => ({ text: b.textContent?.trim(), active: b.classList.contains('active') }));
  });
  console.log(tabsInfo);

  // Click on History tab specifically
  console.log('\n=== Clicking History tab ===');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.debug-tabs button'));
    const historyBtn = buttons.find(b => b.textContent?.includes('History'));
    historyBtn?.click();
  });
  await sleep(2000);

  // Check which tab is active now
  const activeTabInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.debug-tabs button'));
    const active = buttons.find(b => b.classList.contains('active'));
    return active ? active.textContent?.trim() : 'NO ACTIVE TAB';
  });
  console.log('Active tab:', activeTabInfo);

  // Check for history count
  const historyCount = await page.evaluate(() => {
    const count = document.querySelector('.history-count');
    return count ? count.textContent : 'not found';
  });
  console.log('History count:', historyCount);

  // Check for timeline slider
  const sliderInfo = await page.evaluate(() => {
    const slider = document.querySelector('.timeline-slider');
    if (slider) return { found: true, value: slider.value, max: slider.max };
    return { found: false };
  });
  console.log('Timeline slider:', sliderInfo);

  // Since it's a new game with 0 actions, let's test clicking index 0 (initial state)
  // The slider should allow selecting 0
  if (sliderInfo.found && parseInt(sliderInfo.max) >= 0) {
    console.log('\n=== Setting slider to 0 (initial state) ===');
    await page.evaluate(() => {
      const slider = document.querySelector('.timeline-slider');
      if (slider) {
        slider.value = '0';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(2000);

    console.log('\n=== DebugPanel logs after slider change ===');
    logs.filter(l => l.includes('[DebugPanel]')).slice(-10).forEach(l => console.log(l));

    // Now click State tab to see if it changed
    console.log('\n=== Clicking State tab ===');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.debug-tabs button'));
      const stateBtn = buttons.find(b => b.textContent?.includes('State'));
      stateBtn?.click();
    });
    await sleep(500);

    // Check for historical banner
    const historicalBanner = await page.$('.historical-banner');
    if (historicalBanner) {
      const bannerText = await historicalBanner.evaluate(el => el.textContent);
      console.log('Historical banner found:', bannerText);
    } else {
      console.log('No historical banner found');
    }

    // Check displayedState via tree summary
    const treeSummary = await page.evaluate(() => {
      const summary = document.querySelector('.tree-summary');
      return summary ? summary.textContent : 'not found';
    });
    console.log('Tree summary:', treeSummary);
  }

  console.log('\n=== All DebugPanel logs ===');
  logs.filter(l => l.includes('[DebugPanel]')).forEach(l => console.log(l));

  console.log('\nKeeping browser open for 30 seconds...');
  await sleep(30000);
  await browser.close();
}

debug().catch(console.error);
