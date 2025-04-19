import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs/promises';

const app = express();
const PORT = 3000;

puppeteer.use(StealthPlugin());

const requestQueue = [];
let isProcessing = false;
let browser = null;

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  const { artlistUrl, res } = requestQueue.shift();

  try {
    await handleArtlistRequest(artlistUrl, res);
  } catch (err) {
    console.error('❌ Lỗi:', err);
    res.status(500).json({ error: err.message });
  } finally {
    isProcessing = false;
    processQueue();
  }
}

async function initializeBrowser() {
  return await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--no-zygote',
      '--disable-software-rasterizer'
    ],
  });
}

app.get('/api.artlist', (req, res) => {
  const artlistUrl = req.query.url;

  if (!artlistUrl || !artlistUrl.includes('artlist.io')) {
    return res.status(400).json({ error: 'Thiếu hoặc sai định dạng link Artlist' });
  }

  requestQueue.push({ artlistUrl, res });
  processQueue();
});

async function findAndClickPlayButtonAI(page) {
  console.log('🔍 Đang tìm nút Play bằng AI...');

  const screenshotBuffer = await page.screenshot();

  const processedImage = await sharp(screenshotBuffer)
    .resize(800)
    .grayscale()
    .toBuffer();

  await fs.writeFile('screen-temp.png', processedImage);

  const { data: { words } } = await Tesseract.recognize('screen-temp.png', 'eng');

  const playWord = words.find(word => /play|▶/i.test(word.text));

  if (playWord) {
    const x = playWord.bbox.x0 + (playWord.bbox.x1 - playWord.bbox.x0) / 2;
    const y = playWord.bbox.y0 + (playWord.bbox.y1 - playWord.bbox.y0) / 2;

    console.log(`🎯 Tìm thấy "${playWord.text}" tại (${x}, ${y})`);
    await page.mouse.click(x, y);
    return true;
  }

  console.log('❌ AI không tìm thấy nút Play');
  return false;
}

async function handleArtlistRequest(artlistUrl, res) {
  console.log('\n===============================');
  console.log('🚀 Đang xử lý:', artlistUrl);

  browser = await initializeBrowser();
  const page = await browser.newPage();

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);

  let mediaUrl = null;

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('.aac')) {
      console.log('🎵 Bắt được .aac:', url);
      if (!mediaUrl) mediaUrl = url;
    }
    request.continue();
  });

  try {
    await page.goto(artlistUrl, { waitUntil: 'networkidle2' });

    const selector1 = 'button[aria-label="play global player"]';
    const selector2 = 'button[data-testid="renderButton"] span span';
    await page.waitForSelector(`${selector1}, ${selector2}`, { timeout: 10000 });

    const clicked = await page.evaluate(() => {
      const firstPlayBtn = document.querySelector('button[aria-label="play global player"]');
      if (firstPlayBtn) {
        firstPlayBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        firstPlayBtn.click();
        return '▶️ Clicked Play (aria-label)';
      }

      const allButtons = [...document.querySelectorAll('button[data-testid="renderButton"]')];
      const secondPlayBtn = allButtons.find(btn => btn.innerText.trim().toLowerCase() === 'play');
      if (secondPlayBtn) {
        secondPlayBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        secondPlayBtn.click();
        return '▶️ Clicked Play (data-testid)';
      }

      return '⛔ Không tìm thấy nút Play';
    });

    console.log(clicked);

    if (clicked.includes('⛔')) {
      const aiClicked = await findAndClickPlayButtonAI(page);
      if (!aiClicked) {
        return res.status(500).json({ error: 'Không click được nút Play bằng AI' });
      }
    }

    await new Promise(resolve => setTimeout(resolve, 5000)); // Chờ phát

    if (mediaUrl) {
      console.log('✅ Link media:', mediaUrl);
      return res.json({ mediaLink: mediaUrl });
    } else {
      console.log('⚠️ Không tìm thấy file .aac');
      return res.status(404).json({ message: 'Không tìm thấy file .aac' });
    }

  } catch (err) {
    console.error('❌ Lỗi trong page:', err.message);
    throw err;
  } finally {
    console.log('🧾 Đóng trình duyệt\n');
    await page.close();
    await browser.close();
    browser = null;
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server chạy tại: http://localhost:${PORT}/api.artlist?url=...`);
});
