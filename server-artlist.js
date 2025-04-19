import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config({ path: '.envartlist' });

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
const PROTOCOL = process.env.PROTOCOL || 'http';
const API_ROUTE = process.env.API_ROUTE || '/api.artlist';

puppeteer.use(StealthPlugin());

const requestQueue = [];
let isProcessing = false;

// Hàng đợi xử lý tuần tự
async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;

  const { artlistUrl, res } = requestQueue.shift();

  try {
    await handleArtlistRequest(artlistUrl, res);
  } catch (err) {
    console.error('❌ Lỗi:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    isProcessing = false;
    processQueue();
  }
}

app.get(API_ROUTE, (req, res) => {
  const artlistUrl = req.query.url;

  if (!artlistUrl || !artlistUrl.includes('artlist.io')) {
    return res.status(400).json({ error: 'Thiếu hoặc sai định dạng link Artlist' });
  }

  requestQueue.push({ artlistUrl, res });
  processQueue();
});

// Xử lý từng request
async function handleArtlistRequest(artlistUrl, res) {
  console.log('\n===============================');
  console.log('🚀 Đang xử lý:', artlistUrl);

  const browser = await puppeteer.launch({
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

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);

  let mediaSent = false;

  page.on('request', (request) => {
    const url = request.url();
    if (!mediaSent && url.includes('.aac')) {
      console.log('🎵 Bắt được .aac:', url);
      mediaSent = true;
      res.json({ mediaLink: url });
      // Đóng browser ngay sau khi gửi kết quả
      page.close().then(() => browser.close());
    }
    request.continue();
  });

  try {
    await page.goto(artlistUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Chờ và click nút Play để kích hoạt request .aac
    const selector1 = 'button[aria-label="play global player"]';
    const selector2 = 'button[data-testid="renderButton"] span span';
    await page.waitForSelector(selector1, { timeout: 10000, visible: true });
    await page.waitForSelector(selector2, { timeout: 10000, visible: true });

    console.log('🔍 Đang kiểm tra các nút Play...');

    await page.evaluate(() => {
      const firstPlayBtn = document.querySelector('button[aria-label="play global player"]');
      if (firstPlayBtn) {
        firstPlayBtn.click();
        return;
      }

      const allButtons = [...document.querySelectorAll('button[data-testid="renderButton"]')];
      const secondPlayBtn = allButtons.find(btn => btn.innerText.trim().toLowerCase() === 'play');
      if (secondPlayBtn) secondPlayBtn.click();
    });

    // Nếu không bắt được file trong 10s thì trả lỗi
    setTimeout(() => {
      if (!mediaSent && !res.headersSent) {
        console.log('⛔ Hết thời gian chờ, không tìm thấy .aac');
        res.status(404).json({ error: 'Không tìm thấy file .aac' });
        page.close().then(() => browser.close());
      }
    }, 10000);

  } catch (err) {
    console.error('❌ Lỗi trong page:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
    await page.close();
    await browser.close();
  }
}

app.listen(PORT, () => {
  console.log(`${PROTOCOL}://${HOST}:${PORT}${API_ROUTE}?url=...`);
});
