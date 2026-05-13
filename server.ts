import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { YoutubeTranscript } from "youtube-transcript";
import { getSubtitles } from "youtube-caption-extractor";
import { OpenAI } from "openai";
import ytdl from "@distube/ytdl-core";
import fs from "fs";
import { randomUUID } from "crypto";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const upload = multer({ dest: 'uploads/' });

// Helper to chunk and transcribe audio
async function splitAndTranscribe(
  filePath: string, 
  openAiKey: string,
  onProgress?: (text: string) => void
): Promise<{ text: string, cost: number }> {
  const tempDir = path.join(process.cwd(), `temp_${randomUUID()}`);
  fs.mkdirSync(tempDir);
  
  return new Promise((resolve, reject) => {
    // 10 minutes segments
    ffmpeg(filePath)
      .outputOptions([
        '-f', 'segment',
        '-segment_time', '600'
      ])
      .audioCodec('libmp3lame')
      .audioBitrate('48k')
      .output(path.join(tempDir, 'chunk_%03d.mp3'))
      .on('end', async () => {
        try {
          const files = fs.readdirSync(tempDir).filter(f => f.startsWith('chunk_')).sort();
          if (files.length === 0) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            throw new Error('未產生任何音訊分割檔');
          }

          let fullText = "";
          let totalDurationSec = 0;
          const openai = new OpenAI({ apiKey: openAiKey });

          for (const file of files) {
            const chunkPath = path.join(tempDir, file);
            const stats = fs.statSync(chunkPath);
            if (stats.size > 0) {
              const resp = await openai.audio.transcriptions.create({
                file: fs.createReadStream(chunkPath),
                model: "whisper-1",
                response_format: "verbose_json",
                prompt: "Please transcribe the audio in its original language. Add proper punctuation such as commas, periods, and question marks to make the text readable."
              });
              
              const jsonResp = resp as any;
              fullText += jsonResp.text + " ";
              totalDurationSec += (jsonResp.duration || 0);

              if (onProgress) {
                onProgress(jsonResp.text);
              }
            }
          }
          
          fs.rmSync(tempDir, { recursive: true, force: true });
          const cost = (totalDurationSec / 60) * 0.006;
          resolve({ text: fullText.trim(), cost });
        } catch (error) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          reject(error);
        }
      })
      .on('error', (err) => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        reject(err);
      })
      .run();
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API routes
  app.post("/api/transcript", async (req, res) => {
    const { url, openAiKey } = req.body;
    if (!url) return res.status(400).json({ error: "必須提供影片連結" });

    // Extract video ID from URL
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    try {
      let fullText = "";
      let totalCost = 0;

      // Strategy 1: youtube-transcript
      try {
        const transcriptChunks = await YoutubeTranscript.fetchTranscript(url).catch(async () => {
          return await YoutubeTranscript.fetchTranscript(url, { lang: 'zh' }).catch(() => 
            YoutubeTranscript.fetchTranscript(url, { lang: 'en' })
          );
        });
        fullText = transcriptChunks.map(chunk => chunk.text).join(" ");
      } catch (e) {
        console.log("youtube-transcript failed, trying alternative...");
      }

      // Strategy 2: youtube-caption-extractor (if first one failed)
      if (!fullText && videoId) {
        try {
          // Try multiple languages
          const langs = ['zh-TW', 'zh-Hant', 'zh', 'en', 'ja'];
          for (const lang of langs) {
            try {
              const subtitles = await getSubtitles({ videoID: videoId, lang });
              if (subtitles && subtitles.length > 0) {
                fullText = subtitles.map(s => s.text).join(" ");
                break;
              }
            } catch (innerError) {
              continue;
            }
          }
        } catch (e) {
          console.error("youtube-caption-extractor failed:", e);
        }
      }

      // Strategy 3: ytdl-core + Whisper (if no transcript found)
      if (!fullText) {
        if (!openAiKey) {
          console.log("No transcript, and no OpenAI key given. Asking user.");
          throw new Error("無法取得現有逐字稿。若希望系統自動「聽寫」音軌，請務必在側邊欄填寫 OpenAI API 金鑰 (因為會呼叫 Whisper 模型)。");
        }
        
        console.log("No subtitles found. Attempting to download audio and use Whisper...");
        try {
          const info = await ytdl.getInfo(url);
          const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'lowest', filter: 'audioonly' });

          if (audioFormat) {
            const tempFilePath = path.join(process.cwd(), `temp_audio_${randomUUID()}.webm`);
            
            await new Promise<void>((resolve, reject) => {
              const stream = ytdl.downloadFromInfo(info, { format: audioFormat });
              const writeStream = fs.createWriteStream(tempFilePath);
              stream.pipe(writeStream);
              stream.on('end', () => resolve());
              stream.on('error', reject);
              writeStream.on('error', reject);
              writeStream.on('finish', () => resolve());
            });

            // use splitAndTranscribe to handle size limits
            try {
              const { text, cost } = await splitAndTranscribe(tempFilePath, openAiKey);
              fullText = text;
              totalCost = cost;
            } finally {
              if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            }
          } else {
             throw new Error("找不到該影片的音軌。");
          }
        } catch (downloadError: any) {
             console.error("Whisper download/transcribe error:", downloadError);
             const isBotError = downloadError.message && downloadError.message.includes('not a bot');
             const msg = isBotError ? "YouTube 阻擋了伺服器下載：「Sign in to confirm you're not a bot」。\n\n【為什麼其他下載網站可以？】\n因為市面上的下載站通常花費大量成本購買「住宅代理 IP (Residential Proxies)」來偽裝成一般消費者；而本系統部署在雲端資料中心 (Google Cloud)，伺服器 IP 會被 YouTube 瞬間認證為機器人並進行阻擋。\n\n【解法】請使用您平常用的工具或本機軟體下載該影片音源 (MP3/M4A)，接著在此系統左上角切換到「檔案」模式直接上傳，系統依然會幫您做「自動切割 + Whisper 聽寫」的完整流程喔！" : (downloadError.message || "嘗試使用 Whisper 自動聽寫失敗");
             throw new Error(msg);
        }
      }

      if (!fullText) {
          throw new Error("此影片目前無法自動抓取逐字稿或自動分析語音。請手動尋找逐字稿貼入，或利用桌面軟體(剪映)處理。");
      }
      
      res.json({ transcript: fullText, cost: totalCost });
    } catch (error: any) {
      console.error("Transcript error:", error);
      res.status(500).json({ 
        error: error.message || "發生未知錯誤，請稍後再試。" 
      });
    }
  });

  // Chunk upload logic
  app.post("/api/upload-chunk", express.raw({ type: 'application/octet-stream', limit: '10mb' }), (req, res) => {
    const { fileId, chunkIndex } = req.query;
    if (!fileId || typeof chunkIndex !== 'string') return res.status(400).json({ error: "Missing fileId or chunkIndex" });
    
    const chunkPath = path.join(process.cwd(), 'uploads', `${fileId}.part`);
    const isFirstChunk = chunkIndex === "0";
    
    if (!fs.existsSync(path.join(process.cwd(), 'uploads'))) {
      fs.mkdirSync(path.join(process.cwd(), 'uploads'));
    }

    try {
      if (isFirstChunk && fs.existsSync(chunkPath)) {
        fs.unlinkSync(chunkPath);
      }
      fs.appendFileSync(chunkPath, req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save chunk: " + err.message });
    }
  });

  app.get("/api/upload-finish-sse", async (req, res) => {
    const fileId = req.query.fileId as string;
    const openAiKey = req.query.openAiKey as string;

    if (!fileId || !openAiKey) {
      res.status(400).json({ error: "Missing fileId or openAiKey" });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const chunkPath = path.join(process.cwd(), 'uploads', `${fileId}.part`);
    if (!fs.existsSync(chunkPath)) {
      res.write(`data: ${JSON.stringify({ error: "File not found" })}\n\n`);
      return res.end();
    }

    try {
      res.write(`data: ${JSON.stringify({ status: 'started' })}\n\n`);
      
      const { text, cost } = await splitAndTranscribe(chunkPath, openAiKey, (chunkText) => {
         res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
      });
      
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
      
      res.write(`data: ${JSON.stringify({ done: true, transcript: text, cost })}\n\n`);
      res.end();
    } catch (error: any) {
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
      res.write(`data: ${JSON.stringify({ error: error.message || "處理音檔失敗" })}\n\n`);
      res.end();
    }
  });

  app.post("/api/generate-openai", async (req, res) => {
    const { transcript, apiKey, model, prompt, isJson } = req.body;
    if (!apiKey) return res.status(400).json({ error: "API Key is required" });

    try {
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: model || "gpt-4o",
        messages: [
          { role: "system", content: "You are a professional blog writer. Write in Traditional Chinese (Taiwan)." },
          { role: "user", content: `${prompt}\n\nTranscript:\n${transcript}` }
        ],
        response_format: isJson ? { type: "json_object" } : undefined
      });
      res.json({ result: response.choices[0].message.content });
    } catch (error: any) {
      console.error("OpenAI error:", error);
      res.status(500).json({ error: error.message || "Failed to generate blog with OpenAI" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
