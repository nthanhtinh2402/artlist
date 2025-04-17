import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
const PORT = 3000;

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
    res.status(500).json({ error: err.message });
  } finally {
    isProcessing = false;
    processQueue(); // Gọi tiếp request tiếp theo
  }
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

// Hàm xử lý một request Artlist
async function handleArtlistRequest(artlistUrl, res) {
  console.log('\n===============================');
  console.log('🚀 Bắt đầu xử lý URL:', artlistUrl);

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
  });

  await page.setRequestInterception(true);
  let mediaUrl = null;

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('.aac')) {
      console.log('🎵 Bắt được request .aac:', url);
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
        firstPlayBtn.click();
        return '▶️ Clicked nút Play (aria-label)';
      }

      const allButtons = [...document.querySelectorAll('button[data-testid="renderButton"]')];
      const secondPlayBtn = allButtons.find(btn => btn.innerText.trim().toLowerCase() === 'play');
      if (secondPlayBtn) {
        secondPlayBtn.click();
        return '▶️ Clicked nút Play (data-testid)';
      }

      return '⛔ Không tìm thấy nút Play phù hợp';
    });

    console.log(clicked);
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (mediaUrl) {
      console.log('✅ Media URL:', mediaUrl);
      return res.json({ mediaLink: mediaUrl });
    } else {
      console.log('⚠️ Không tìm thấy file .aac');
      return res.json({ message: 'Không tìm thấy file .aac' });
    }
  } catch (err) {
    console.error('❌ Lỗi xử lý:', err.message);
    throw err;
  } finally {
    console.log('🧾 Đóng trình duyệt\n');
    await page.close();
    await browser.close();
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server chạy tại: http://localhost:${PORT}/api.artlist?url=...`);
});
