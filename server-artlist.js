import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const app = express();
const PORT = 3000;

puppeteer.use(StealthPlugin());

const requestQueue = [];
let isProcessing = false;
let browser = null;

// Xử lý hàng đợi
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

// Khởi tạo browser
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

// Route API
app.get('/api.artlist', (req, res) => {
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

    // Tương tác giả để kích hoạt autoplay
    await page.mouse.move(200, 400);
    await page.mouse.click(200, 400, { delay: 100 });

    // Click Play bằng Puppeteer
    const selector1 = 'button[aria-label="play global player"]';
    const selector2 = 'button[data-testid="renderButton"] span span';

    try {
      await page.waitForSelector(selector1, { timeout: 5000 });
      await page.hover(selector1);
      await page.click(selector1);
      console.log('▶️ Đã click nút Play (aria-label)');
    } catch (e) {
      try {
        const button = await page.$x("//button[contains(., 'Play')]");
        if (button.length > 0) {
          await button[0].hover();
          await button[0].click();
          console.log('▶️ Đã click nút Play (text content)');
        } else {
          console.log('⛔ Không tìm thấy nút Play');
        }
      } catch (e2) {
        console.log('⛔ Không thể click nút Play');
      }
    }

    // Chờ media tải
    await new Promise(resolve => setTimeout(resolve, 5000));

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
