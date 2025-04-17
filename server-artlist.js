import express from 'express';
import puppeteer from 'puppeteer';
import Tesseract from 'tesseract.js';
import Xvfb from 'xvfb';

const app = express();
const PORT = 3000;

const requestQueue = [];
let isProcessing = false;
let browser; // Tạo browser global để tái sử dụng

// Khởi động Xvfb trước khi chạy Puppeteer
const xvfb = new Xvfb();
xvfb.startSync(); // Bắt đầu Xvfb đồng bộ

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

// Tạo trình duyệt chỉ khi có yêu cầu đầu tiên
async function initializeBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: false,  // Chạy không có giao diện người dùng
      args: [
        '--start-maximized',
        '--no-sandbox',  // Thêm tham số này để tránh lỗi khi chạy dưới quyền root
        '--disable-setuid-sandbox', // Thêm tham số này nếu cần thiết
        '--disable-gpu', // Tắt GPU nếu cần thiết
        '--remote-debugging-port=9222', // Nếu muốn remote debug
      ],
    });
    console.log('🚀 Puppeteer đã sẵn sàng');
  }
}

// Route API
app.get('/api.artlist', (req, res) => {
  const artlistUrl = req.query.url;

  if (!artlistUrl || !artlistUrl.includes('artlist.io')) {
    return res.status(400).json({ error: 'Thiếu hoặc sai định dạng link Artlist' });
  }

  requestQueue.push({ artlistUrl, res });
  processQueue(); // Xử lý các truy vấn theo hàng đợi
});

// Hàm xử lý một request Artlist
async function handleArtlistRequest(artlistUrl, res) {
  console.log('\n===============================');
  console.log('🚀 Bắt đầu xử lý URL:', artlistUrl);

  // Khởi tạo trình duyệt nếu chưa có
  await initializeBrowser();

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
      if (!mediaUrl) mediaUrl = url; // Lấy mediaUrl đầu tiên gặp phải
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
        // Giả lập sự kiện hover trước khi click
        firstPlayBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        firstPlayBtn.click();
        return '▶️ Clicked nút Play (aria-label)';
      }

      const allButtons = [...document.querySelectorAll('button[data-testid="renderButton"]')];
      const secondPlayBtn = allButtons.find(btn => btn.innerText.trim().toLowerCase() === 'play');
      if (secondPlayBtn) {
        // Giả lập sự kiện hover trước khi click
        secondPlayBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        secondPlayBtn.click();
        return '▶️ Clicked nút Play (data-testid)';
      }

      return '⛔ Không tìm thấy nút Play phù hợp';
    });

    console.log(clicked);
    await new Promise(resolve => setTimeout(resolve, 5000)); // Đợi vài giây để video bắt đầu phát

    if (mediaUrl) {
      console.log('✅ Media URL:', mediaUrl);

      // Nếu muốn dùng OCR để nhận dạng văn bản trong ảnh (ví dụ ảnh chứa captcha, nút, v.v.)
      const text = await runOCR(mediaUrl);
      console.log('✅ Kết quả OCR:', text);

      return res.json({ mediaLink: mediaUrl, ocrResult: text });
    } else {
      console.log('⚠️ Không tìm thấy file .aac');
      return res.json({ message: 'Không tìm thấy file .aac' });
    }
  } catch (err) {
    console.error('❌ Lỗi xử lý:', err.message);
    throw err; // Thực hiện ném lỗi để bắt lại trong phần `catch` của `processQueue()`
  } finally {
    console.log('🧾 Đóng tab\n');
    await page.close();
  }
}

// Hàm chạy OCR với Tesseract.js
async function runOCR(imageUrl) {
  return new Promise((resolve, reject) => {
    // Giả sử bạn tải về ảnh từ mediaUrl trước khi chạy OCR
    Tesseract.recognize(
      imageUrl,
      'eng', // Ngôn ngữ nhận dạng, có thể thay đổi
      {
        logger: (m) => console.log(m), // Log quá trình nhận dạng
      }
    ).then(({ data: { text } }) => {
      resolve(text); // Trả về văn bản đã nhận dạng được
    }).catch((err) => {
      reject(err);
    });
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server chạy tại: http://localhost:${PORT}/api.artlist?url=...`);
});
