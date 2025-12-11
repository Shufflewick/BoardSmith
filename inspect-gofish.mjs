import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

// Capture console logs
page.on('console', msg => {
  console.log('CONSOLE:', msg.type(), msg.text());
});

await page.goto('http://localhost:5173/game/px01a1zw/0', { waitUntil: 'networkidle0', timeout: 10000 });

// Wait for the game to load
await page.waitForSelector('.auto-ui', { timeout: 5000 }).catch(() => console.log('No .auto-ui found'));

// Get the structure of the Auto-UI hand cards
const analysis = await page.evaluate(() => {
  const results = {
    autoUIBounds: null,
    handContainerBounds: null,
    handCardsBounds: null,
    cardBounds: [],
    cardStyles: [],
    parentChain: []
  };

  // Find the Auto-UI container
  const autoUI = document.querySelector('.auto-ui');
  if (autoUI) {
    results.autoUIBounds = autoUI.getBoundingClientRect();
  }

  // Find hand containers in auto-ui
  const handContainers = document.querySelectorAll('.auto-ui .hand-container');
  if (handContainers.length > 0) {
    results.handContainerBounds = handContainers[0].getBoundingClientRect();
  }

  // Find hand-cards
  const handCards = document.querySelectorAll('.auto-ui .hand-cards');
  if (handCards.length > 0) {
    results.handCardsBounds = handCards[0].getBoundingClientRect();
  }

  // Find individual cards and their positions
  const cards = document.querySelectorAll('.auto-ui .hand-card');
  cards.forEach((card, i) => {
    const rect = card.getBoundingClientRect();
    const style = window.getComputedStyle(card);
    results.cardBounds.push({
      index: i,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    });
    results.cardStyles.push({
      index: i,
      position: style.position,
      marginRight: style.marginRight,
      marginLeft: style.marginLeft,
      transform: style.transform,
      width: style.width
    });
  });

  // Get parent chain for first card
  const firstCard = document.querySelector('.auto-ui .hand-card');
  if (firstCard) {
    let el = firstCard;
    while (el && el !== document.body) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      results.parentChain.push({
        tag: el.tagName,
        className: el.className.substring(0, 50),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        position: style.position,
        overflow: style.overflow,
        transform: style.transform
      });
      el = el.parentElement;
    }
  }

  return results;
});

console.log('\n=== AUTO-UI BOUNDS ===');
console.log(JSON.stringify(analysis.autoUIBounds, null, 2));

console.log('\n=== HAND CONTAINER BOUNDS ===');
console.log(JSON.stringify(analysis.handContainerBounds, null, 2));

console.log('\n=== HAND CARDS BOUNDS ===');
console.log(JSON.stringify(analysis.handCardsBounds, null, 2));

console.log('\n=== INDIVIDUAL CARD BOUNDS ===');
analysis.cardBounds.forEach(c => console.log(JSON.stringify(c)));

console.log('\n=== CARD STYLES ===');
analysis.cardStyles.forEach(c => console.log(JSON.stringify(c)));

console.log('\n=== PARENT CHAIN (from first card to body) ===');
analysis.parentChain.forEach((p, i) => {
  console.log(i + ': ' + p.tag + '.' + p.className + ' left=' + p.left + ' width=' + p.width + ' pos=' + p.position + ' overflow=' + p.overflow);
});

await browser.close();
