import { useState, useEffect } from 'react';
import { Youtube, Key, Sparkles, BookOpen, AlertCircle, Loader2, ChevronRight, Clipboard, Check, FileDown, FileCode } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Default models
const GEN_MODELS = [
  { 
    id: 'gemini-3-flash-preview', 
    name: 'Gemini 3 Flash 預覽版 (快速)', 
    type: 'gemini',
    price: { input: 0.10, output: 0.40 }
  },
  { 
    id: 'gemini-3.1-pro-preview', 
    name: 'Gemini 3.1 Pro 預覽版 (強大)', 
    type: 'gemini',
    price: { input: 1.25, output: 5.00 }
  },
  { 
    id: 'gemini-3.1-flash-lite', 
    name: 'Gemini 3.1 Flash Lite (最快)', 
    type: 'gemini',
    price: { input: 0.075, output: 0.30 }
  },
  { 
    id: 'gemini-2.5-pro', 
    name: 'Gemini 2.5 Pro (舊版)', 
    type: 'gemini',
    price: { input: 1.25, output: 5.00 }
  },
  { 
    id: 'gemini-2.5-flash', 
    name: 'Gemini 2.5 Flash (舊版)', 
    type: 'gemini',
    price: { input: 0.075, output: 0.30 }
  },
  { 
    id: 'gpt-5.4-pro', 
    name: 'OpenAI GPT-5.4 Pro', 
    type: 'openai',
    price: { input: 10.00, output: 30.00 }
  },
  { 
    id: 'gpt-5.4-mini', 
    name: 'OpenAI GPT-5.4 Mini', 
    type: 'openai',
    price: { input: 0.15, output: 0.60 }
  },
  { 
    id: 'gpt-5.4-nano', 
    name: 'OpenAI GPT-5.4 Nano', 
    type: 'openai',
    price: { input: 0.05, output: 0.20 }
  },
  { 
    id: 'gpt-4o', 
    name: 'OpenAI GPT-4o', 
    type: 'openai',
    price: { input: 5.00, output: 15.00 }
  },
  { 
    id: 'gpt-4o-mini', 
    name: 'OpenAI GPT-4o Mini', 
    type: 'openai',
    price: { input: 0.15, output: 0.60 }
  }
];

export default function App() {
  const [url, setUrl] = useState('');
  const [manualTranscript, setManualTranscript] = useState('');
  const [inputMode, setInputMode] = useState<'url' | 'manual' | 'file'>('url');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModel] = useState(GEN_MODELS[0].id);
  const [openAiKey, setOpenAiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [blogPost, setBlogPost] = useState('');
  const [fullTranscript, setFullTranscript] = useState('');
  const [activeTab, setActiveTab] = useState<'blog' | 'transcript'>('blog');
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [progress, setProgress] = useState(0);
  const [usageInfo, setUsageInfo] = useState<{ tokens: number; costTWD: number, whisperCostTWD?: number, transcriptLength?: number, blogLength?: number } | null>(null);

  // Load keys from localStorage if any
  useEffect(() => {
    const storedOpenAiKey = localStorage.getItem('openai_key');
    const storedGeminiKey = localStorage.getItem('gemini_key');
    if (storedOpenAiKey) setOpenAiKey(storedOpenAiKey);
    if (storedGeminiKey) setGeminiKey(storedGeminiKey);
  }, []);

  const saveKeys = (oKey: string, gKey: string) => {
    localStorage.setItem('openai_key', oKey);
    localStorage.setItem('gemini_key', gKey);
  };

  const handleCopy = () => {
    const textToCopy = activeTab === 'blog' ? blogPost : fullTranscript;
    navigator.clipboard.writeText(textToCopy);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const calculateCost = (inputChars: number, outputChars: number, modelId: string) => {
    const model = GEN_MODELS.find(m => m.id === modelId);
    if (!model) return { tokens: 0, costTWD: 0 };

    // Rough estimation: 1 token ≈ 1.5 characters for CJK/Mixed text
    const inputTokens = Math.ceil(inputChars / 0.8);
    const outputTokens = Math.ceil(outputChars / 0.8);
    const totalTokens = inputTokens + outputTokens;

    const costUSD = (inputTokens * (model.price.input / 1000000)) + (outputTokens * (model.price.output / 1000000));
    const costTWD = costUSD * 32; // Assuming 1 USD = 32 TWD

    return { tokens: totalTokens, costTWD };
  };

  const generateBlog = async () => {
    if (inputMode === 'url' && !url) {
      setError('請輸入 YouTube 連結');
      return;
    }
    if (inputMode === 'manual' && !manualTranscript) {
      setError('請貼上影片逐字稿');
      return;
    }
    if (inputMode === 'file' && !uploadFile) {
      setError('請選擇要上傳的音檔或影片');
      return;
    }
    if (inputMode === 'file' && !openAiKey) {
      setError('請在側邊欄上方填寫 OpenAI API 金鑰，因為音檔辨識需要使用 Whisper 模型。');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStatusMsg(null);
    setInterimTranscript('');
    setFullTranscript('');
    setBlogPost('');
    setUsageInfo(null);
    setProgress(10);

    try {
      let transcript = '';
      let whisperCost = 0;

      if (inputMode === 'url') {
        // 1. Get Transcript from URL
        const transcriptRes = await fetch('/api/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, openAiKey }),
        });
        const transcriptData = await transcriptRes.json();

        if (!transcriptRes.ok) throw new Error(transcriptData.error);
        transcript = transcriptData.transcript;
        if (transcriptData.cost) whisperCost = transcriptData.cost;
      } else if (inputMode === 'manual') {
        // Use manual transcript
        transcript = manualTranscript;
      } else if (inputMode === 'file') {
        // Chunk upload
        const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
        const fileId = crypto.randomUUID();
        const totalChunks = Math.ceil((uploadFile as File).size / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, (uploadFile as File).size);
          const chunk = (uploadFile as File).slice(start, end);
          
          setStatusMsg(`正在上傳檔案... (${i + 1}/${totalChunks})`);
          
          const chunkRes = await fetch(`/api/upload-chunk?fileId=${fileId}&chunkIndex=${i}`, {
             method: 'POST',
             headers: {
                'Content-Type': 'application/octet-stream'
             },
             body: chunk
          });

          if (!chunkRes.ok) {
             let errText = "Chunk upload failed";
             try {
                const chunkErr = await chunkRes.json();
                errText = chunkErr.error || errText;
             } catch {
                errText = await chunkRes.text();
             }
             throw new Error(`上傳時發生錯誤 (${i+1}/${totalChunks}): ` + errText);
          }
        }

        setStatusMsg('檔案上傳完畢！伺服器正在分割音檔並呼叫 Whisper 進行辨識 (即時串流中)...');

        await new Promise<void>((resolve, reject) => {
           const sse = new EventSource(`/api/upload-finish-sse?fileId=${fileId}&openAiKey=${encodeURIComponent(openAiKey)}`);
           
           sse.onmessage = (event) => {
              const data = JSON.parse(event.data);
              if (data.error) {
                 sse.close();
                 reject(new Error(data.error));
              } else if (data.chunk) {
                 // We can display the interim transcript in the UI
                 setInterimTranscript(prev => prev + (prev ? " " : "") + data.chunk);
              } else if (data.done) {
                 transcript = data.transcript;
                 if (data.cost !== undefined) whisperCost = data.cost;
                 sse.close();
                 resolve();
              }
           };
           sse.onerror = (err) => {
              sse.close();
              reject(new Error("無法連接至伺服器，或連線逾時。"));
           }
        });
        
        if (!transcript) throw new Error('語音辨識完成，但未偵測到任何文字。');
        setStatusMsg(null);
      }

      setProgress(40);

      const modelInfo = GEN_MODELS.find(m => m.id === selectedModel);
      const isGemini = modelInfo?.type === 'gemini';

      const callModel = async (promptText: string, systemContext?: string, isJson?: boolean): Promise<string> => {
        if (isGemini) {
          const activeKey = geminiKey || (process.env.GEMINI_API_KEY as string);
          if (!activeKey) throw new Error('找不到 Gemini API Key');
          const ai = new GoogleGenAI({ apiKey: activeKey });
          
          let contents = '';
          if (systemContext) contents += `【系統提示】\n${systemContext}\n\n`;
          contents += promptText;

          const response = await ai.models.generateContent({
            model: selectedModel,
            contents: contents,
            config: isJson ? { responseMimeType: "application/json" } : undefined
          });
          return response.text || '';
        } else {
          if (!openAiKey) throw new Error('請在側邊欄輸入 OpenAI API Key');
          const generateRes = await fetch('/api/generate-openai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcript,
              apiKey: openAiKey,
              model: selectedModel,
              prompt: systemContext ? `${systemContext}\n\n${promptText}` : promptText,
              isJson: isJson
            }),
          });
          const generateData = await generateRes.json();
          if (!generateRes.ok) throw new Error(generateData.error);
          return generateData.result;
        }
      };

      setProgress(50);
      setStatusMsg('第一階段：分析逐字稿，提取大綱與關鍵議題...');

      const step1SystemContext = `你是一個極度專業的數位內容創作者與資深資料分析師。請分析逐字稿並回傳純 JSON 格式資料。如果系統不支援 JSON schema，請務必只輸出 JSON，不要加 markdown block。`;
      const step1Prompt = `請閱讀以下逐字稿，提取「核心大綱」、「10大金句」、「全文思維導圖」。
此外，請根據文本長度與內容豐富度，動態提取「2 到 5 個最核心的關鍵議題」，並為每個議題指定擴寫字數（300 到 1000 字，依重要度決定）。

你必須完全以 JSON 格式回傳，內容必須遵循以下結構：
{
  "title": "文章標題 (吸引人且專業)",
  "overview": "文章前言與核心大綱 (約 300 字)",
  "mindMap": "全文思維導圖 (Markdown 條列式清單結構，用以讓讀者有宏觀視角，預覽接下來的關鍵議題與文章架構)",
  "keyQuotes": [ "金句1", "金句2", "金句3", "金句4", "金句5", "金句6", "金句7", "金句8", "金句9", "金句10" ],
  "issues": [
    { 
      "id": 1, 
      "topic": "關鍵議題 一：...", 
      "context": "探討的方向與細節...",
      "targetWords": 800
    }
    // 根據內容長短與豐富度，決定產生 2-5 個議題。targetWords 介於 300-1000。
  ],
  "conclusionDirection": "總結與反思方向預告"
}

以下是逐字稿內容：
${transcript}
`;

      const step1Result = await callModel(step1Prompt, step1SystemContext, true);
      let outline;
      try {
        let cleanJson = step1Result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
        outline = JSON.parse(cleanJson);
      } catch (e) {
        console.error("Failed to parse JSON", step1Result);
        throw new Error("模型回傳的大綱格式錯誤，請再試一次。");
      }

      let finalContent = `# ${outline.title}\n\n${outline.overview}\n\n## 全文思維導圖 / 目錄架構\n\n${outline.mindMap}\n\n---\n\n`;
      setFullTranscript(transcript);

      // Process each issue sequentially
      for (let i = 0; i < outline.issues.length; i++) {
        const issue = outline.issues[i];
        setProgress(50 + (i * 10));
        setStatusMsg(`第二階段：深入探討關鍵議題 ${i + 1}/${outline.issues.length} (${issue.topic.substring(0, 15)}...)...`);

        const step2SystemContext = `你是一個極度專業的商業分析師與專欄作家。正在撰寫一篇深度解析長文的重要段落。`;
        const step2Prompt = `這篇文章的主題是：${outline.title}
文章大綱概要：${outline.overview}

現在，請【只針對以下這個關鍵議題】進行深度撰寫：
議題：${issue.topic}
探討方向：${issue.context}

規範：
1. 字數要求：這一段落必須寫滿約 ${issue.targetWords || 600} 字！請根據重要度進行深度挖掘。
2. 內容要求：進行「背景知識補充」、「產業影響分析與歷史脈絡」。每提到一個細節，就發散論述，提供實務案例分析與對比。深入底層邏輯。
3. 結構要求：使用 Markdown 格式（以 H2 \`##\` 開頭）。必須包含「核心觀點解析」、「實務應用探討」、「背後邏輯預測」等子單元。
4. 金句引用：請適當從這清單中引用金句：${JSON.stringify(outline.keyQuotes)}。引用時使用 Markdown blockquote \`>\`。
5. 不要寫任何文章結語，不需包含前言，專注在這個議題的論述。

以下是完整的逐字稿作為參考：
${transcript}
`;
        const issueContent = await callModel(step2Prompt, step2SystemContext);
        finalContent += `${issueContent}\n\n---\n\n`;
      }

      setProgress(90);
      setStatusMsg('第三階段：撰寫深度重點反思與收尾...');
      
      const step3SystemContext = `你是一個極度專業的商業分析師與專欄作家。正在為一篇深度長文撰寫結尾與反思。`;
      const step3Prompt = `文章主題：${outline.title}
文章大綱：${outline.overview}

請為這篇深度長文寫一個強而有力的結尾段落與反思。
方向：${outline.conclusionDirection}

規範：
1. 多角度辯證：引入反面觀點與批判性思考。深入剖析影片「潛在資訊偏誤」、「倖存者偏差」或「未被提及的風險」。
2. 行動呼籲：給讀者具體實踐建議。
3. 參考文獻：附上至少 5 個真實、具權威性的相關參考方向（如學術領域、頂級期刊或關鍵字），並詳細寫出推薦理由。
4. 字數要求：至少寫滿 1000 字。
5. 結構：以 \`## 深度重點反思與產業洞察\` 開頭，接著 \`## 行動呼籲 (Call to Action)\`，最後是 \`## 參考文獻與延伸閱讀\`。

完整的逐字稿參考：
${transcript}
`;
      const conclusionContent = await callModel(step3Prompt, step3SystemContext);
      finalContent += `${conclusionContent}\n`;

      setBlogPost(finalContent);
      
      // Calculate approximate Cost (3 calls + 1 setup call means transcript is passed 4 times total + some output)
      // Actually it's passed 1 + issues.length + 1 times.
      const multiplier = 2 + outline.issues.length;
      const info = calculateCost((step1Prompt.length + transcript.length) * multiplier, finalContent.length, selectedModel);
      setUsageInfo({
        ...info,
        whisperCostTWD: whisperCost * 32, // Convert USD to TWD
        transcriptLength: transcript.length,
        blogLength: finalContent.length
      });
      
      setProgress(100);
    } catch (err: any) {
      let errMsg = err.message || '發生未知錯誤';
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.error && parsed.error.message) {
           errMsg = parsed.error.message;
        }
      } catch (e) {
        // Not JSON
      }
      
      if (errMsg.includes('Requested entity was not found') || errMsg.includes('NotFound')) {
         errMsg = '選定的模型不存在或無權限存取 (404 Not Found)。請嘗試切換至其他 AI 模型。';
      }
      
      setError(errMsg);
      setProgress(0);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportPdf = () => {
    window.print();
  };

  const handleExportHtml = () => {
    const element = document.getElementById('blog-post-content');
    if (!element) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="zh-TW">
      <head>
        <meta charset="UTF-8">
        <title>AI 訪談整理專家 - 匯出文章</title>
        <style>
          body {
            font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
            background-color: #1a1a1a;
            color: rgba(255, 255, 255, 0.8);
            line-height: 2;
            padding: 40px 20px;
            max-width: 800px;
            margin: 0 auto;
          }
          h1, h2, h3, h4 { color: rgba(255, 255, 255, 0.9); font-weight: 700; margin-top: 2.5em; margin-bottom: 1em; }
          h2 { color: #d4af37; font-size: 1.25rem; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5em; }
          h3 { font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; font-size: 1.35rem; }
          p { margin-bottom: 1.5em; font-size: 1.125rem; }
          blockquote {
            font-style: italic;
            border-left: 2px solid #d4af37;
            padding: 15px 25px;
            background-color: rgba(255,255,255,0.02);
            margin: 2em 0;
            color: rgba(255, 255, 255, 0.7);
            border-top-right-radius: 8px;
            border-bottom-right-radius: 8px;
          }
          ul, ol { margin-bottom: 1.5em; padding-left: 1.5em; font-size: 1.125rem; }
          li { margin-bottom: 0.75em; }
          strong { color: rgba(255, 255, 255, 0.9); font-weight: bold; }
          a { color: #d4af37; text-decoration: underline; }
          
          /* Hide things like Cost Summary from the HTML export if necessary, but it looks fine within context */
        </style>
      </head>
      <body>
        ${element.innerHTML}
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'AI-Article-Export.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-dark-ebony text-text-dim font-sans overflow-hidden">
      {/* Top Navigation Header */}
      <header className="h-16 flex items-center justify-between px-8 border-b border-border-subtle bg-dark-ebony shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-gold to-gold-light rounded-sm rotate-45 flex items-center justify-center">
            <div className="w-4 h-4 bg-dark-ebony rounded-full"></div>
          </div>
          <span className="text-xl font-light tracking-[0.2em] uppercase text-gold">AI 訪談整理專家</span>
        </div>
        <div className="flex items-center gap-6 text-[10px] tracking-[0.25em] uppercase opacity-40 font-bold">
          <span>AI 助手</span>
          <span className="w-1 h-1 bg-gold rounded-full"></span>
          <span>影片轉文章</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Configuration */}
        <aside className="w-80 border-r border-border-subtle bg-dark-charcoal p-6 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
          {/* API Configuration */}
          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-gold font-bold">模型設定</h3>
            <div className="space-y-4">
              <div className="group">
                <label className="block text-[11px] mb-1.5 opacity-50 uppercase tracking-wider">選擇 AI 模型</label>
                <select
                  className="w-full bg-dark-steel border border-border-subtle rounded px-3 py-2 text-xs focus:border-gold outline-none cursor-pointer appearance-none text-white"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {GEN_MODELS.map(m => (
                    <option key={m.id} value={m.id} className="bg-dark-charcoal">{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="group">
                <div className="flex justify-between items-center mb-1.5 ">
                  <label className="block text-[11px] opacity-50 uppercase tracking-wider">OpenAI API 金鑰</label>
                  <a 
                    href="https://platform.openai.com/api-keys" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-[10px] text-gold hover:underline flex items-center gap-1"
                  >
                    取得金鑰 <ChevronRight className="w-2.5 h-2.5" />
                  </a>
                </div>
                <input
                  type="password"
                  placeholder="sk-..."
                  className="w-full bg-dark-steel border border-border-subtle rounded px-3 py-2 text-xs focus:border-gold outline-none transition-colors"
                  value={openAiKey}
                  onChange={(e) => {
                    setOpenAiKey(e.target.value);
                    saveKeys(e.target.value, geminiKey);
                  }}
                />
              </div>
              <div className="group">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[11px] opacity-50 uppercase tracking-wider">Gemini API 金鑰 (選填)</label>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-[10px] text-gold hover:underline flex items-center gap-1"
                  >
                    取得金鑰 <ChevronRight className="w-2.5 h-2.5" />
                  </a>
                </div>
                <input
                  type="password"
                  placeholder="輸入金鑰..."
                  className="w-full bg-dark-steel border border-border-subtle rounded px-3 py-2 text-xs focus:border-gold outline-none transition-colors"
                  value={geminiKey}
                  onChange={(e) => {
                    setGeminiKey(e.target.value);
                    saveKeys(openAiKey, e.target.value);
                  }}
                />
              </div>
            </div>
          </section>

          {/* Source Input */}
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-gold font-bold">輸入來源</h3>
              <div className="flex bg-dark-steel rounded p-0.5 border border-border-subtle">
                <button 
                  onClick={() => setInputMode('url')}
                  className={cn(
                    "px-2 py-1 text-[9px] uppercase tracking-tighter rounded transition-all",
                    inputMode === 'url' ? "bg-gold text-dark-ebony font-bold" : "opacity-40 hover:opacity-100"
                  )}
                >
                  連結
                </button>
                <button 
                  onClick={() => setInputMode('manual')}
                  className={cn(
                    "px-2 py-1 text-[9px] uppercase tracking-tighter rounded transition-all",
                    inputMode === 'manual' ? "bg-gold text-dark-ebony font-bold" : "opacity-40 hover:opacity-100"
                  )}
                >
                  手動
                </button>
                <button 
                  onClick={() => setInputMode('file')}
                  className={cn(
                    "px-2 py-1 text-[9px] uppercase tracking-tighter rounded transition-all",
                    inputMode === 'file' ? "bg-gold text-dark-ebony font-bold" : "opacity-40 hover:opacity-100"
                  )}
                >
                  檔案
                </button>
              </div>
            </div>
            <div className="space-y-4">
              <AnimatePresence mode="wait">
                {inputMode === 'url' ? (
                  <motion.div
                    key="url-input"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="group"
                  >
                    <label className="block text-[11px] mb-1.5 opacity-50 uppercase tracking-wider">YouTube 連結</label>
                    <input
                      type="text"
                      placeholder="youtube.com/watch?v=..."
                      className="w-full bg-dark-steel border border-border-subtle rounded px-3 py-2 text-xs text-gold font-mono focus:border-gold outline-none italic transition-colors"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </motion.div>
                ) : inputMode === 'manual' ? (
                  <motion.div
                    key="manual-input"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="group"
                  >
                    <label className="block text-[11px] mb-1.5 opacity-50 uppercase tracking-wider">影片逐字稿</label>
                    <div className="space-y-3">
                      <textarea
                        placeholder="請貼上影片中的逐字稿內容..."
                        className="w-full h-40 bg-dark-steel border border-border-subtle rounded px-3 py-2 text-xs text-gold font-mono focus:border-gold outline-none transition-colors resize-none custom-scrollbar"
                        value={manualTranscript}
                        onChange={(e) => setManualTranscript(e.target.value)}
                      />
                      <div className="p-3 bg-white/[0.02] border border-border-subtle rounded-lg space-y-2">
                        <p className="text-[10px] text-gold font-bold uppercase tracking-wider">如何取得 YouTube 逐字稿？</p>
                        <ol className="text-[10px] text-white/50 space-y-1 list-decimal pl-4">
                          <li>到 YouTube 影片下方點擊「...」更多按鈕</li>
                          <li>點選「顯示逐字稿」 (Show transcript)</li>
                          <li>將出現的內容全部框選、複製 (Ctrl+C)</li>
                          <li>回到這裡貼上 (Ctrl+V) 即可開始生成</li>
                        </ol>
                        <p className="text-[10px] text-gold font-bold uppercase tracking-wider pt-2 mt-2 border-t border-border-subtle/30">影片完全沒字幕怎麼辦？</p>
                        <p className="text-[10px] text-white/50 leading-relaxed">
                          如果找不到逐字稿，您可以選擇上方「檔案」分頁，直接上傳最大 25MB 的音訊/影片讓 AI 當場聽寫喔。
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="file-input"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="group"
                  >
                    <label className="block text-[11px] mb-1.5 opacity-50 uppercase tracking-wider">上傳音檔/影片 (無大小限制，系統會自動分割)</label>
                    <div className="w-full bg-dark-steel border border-border-subtle rounded px-3 py-4 flex flex-col items-center justify-center gap-2 border-dashed relative overflow-hidden transition-colors hover:border-gold/50 cursor-pointer">
                      <input
                        type="file"
                        accept="audio/*,video/mp4,video/webm"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      />
                      <div className="p-2 bg-dark-charcoal rounded-full border border-border-subtle text-white/50">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-bold text-gold uppercase tracking-wider">點選或拖曳檔案</span>
                      {uploadFile && (
                        <p className="text-[10px] text-white/50 px-2 text-center break-all line-clamp-1 relative z-10 w-full">
                          已選擇: {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                        </p>
                      )}
                    </div>
                    <div className="mt-3 p-3 bg-white/[0.02] border border-border-subtle rounded-lg space-y-2">
                      <p className="text-[10px] text-gold font-bold uppercase tracking-wider text-center">使用 Whisper 進行聽寫</p>
                      <p className="text-[10px] text-white/50 leading-relaxed">
                        直接上傳您的影片或音檔，系統將呼叫 <strong>OpenAI Whisper</strong> 將其轉換為文字並自動切割音檔以突破 25MB 上限。
                      </p>
                      <div className="text-[10px] text-red-400 font-medium pt-2 border-t border-border-subtle/30 space-y-1">
                        <p>* 必須在側邊欄上方填寫 <strong>OpenAI API 金鑰</strong>。</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <button
                onClick={generateBlog}
                disabled={isProcessing}
                className="w-full bg-gold text-dark-ebony py-3 rounded text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-gold-light disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-gold/10"
              >
                {isProcessing ? '正在處理中...' : '開始生成 Blog 文章'}
              </button>
            </div>
          </section>

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-red-950/20 border border-red-900/30 text-red-400 rounded text-[11px] flex gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="whitespace-pre-wrap leading-relaxed">{error}</p>
            </motion.div>
          )}

          {/* Progress Info */}
          {(isProcessing || progress > 0) && (
            <div className="mt-auto">
              <div className="p-4 bg-dark-steel rounded-lg border border-border-subtle border-dashed">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-2">處理狀態</p>
                <div className="flex justify-between items-end">
                  <span className="text-xs font-serif italic text-white/80">
                    {progress === 100 ? '分析完成' : isProcessing ? '整理思維中...' : '待機'}
                  </span>
                  <span className="text-[10px] text-gold font-mono">{progress}%</span>
                </div>
                <div className="w-full h-px bg-border-subtle mt-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-gold"
                  ></motion.div>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content: Blog Preview */}
        <main className="flex-1 bg-dark-ebony flex flex-col p-4 md:p-10 overflow-hidden">
          <div className="max-w-5xl mx-auto w-full h-full flex flex-col relative">
            
            {/* Copy & PDF Button Floating */}
            {(blogPost || fullTranscript) && (
              <div className="absolute top-4 right-4 z-20 flex gap-2">
                {activeTab === 'blog' && (
                  <>
                    <button
                      onClick={handleExportHtml}
                      className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-dark-charcoal/80 backdrop-blur-sm border border-border-subtle rounded hover:bg-dark-steel transition-all text-white/80 hover:text-white"
                    >
                      <FileCode className="w-3 h-3" />
                      輸出 HTML
                    </button>
                    <button
                      onClick={handleExportPdf}
                      className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-dark-charcoal/80 backdrop-blur-sm border border-border-subtle rounded hover:bg-dark-steel transition-all text-white/80 hover:text-white"
                    >
                      <FileDown className="w-3 h-3" />
                      輸出 PDF
                    </button>
                  </>
                )}
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-dark-charcoal/80 backdrop-blur-sm border border-border-subtle rounded hover:bg-dark-steel transition-all text-gold"
                >
                  {copySuccess ? <Check className="w-3 h-3" /> : <Clipboard className="w-3 h-3" />}
                  {copySuccess ? '已複製' : '點擊複製'}
                </button>
              </div>
            )}

            {/* Content Tabs */}
            {(blogPost || fullTranscript) && !isProcessing && (
              <div className="absolute top-4 left-6 z-20 flex gap-2">
                <button
                  onClick={() => setActiveTab('blog')}
                  className={cn(
                    "flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded transition-all",
                    activeTab === 'blog' 
                      ? "bg-gold text-dark-ebony shadow-lg" 
                      : "bg-dark-charcoal/80 text-white/50 border border-border-subtle hover:text-gold"
                  )}
                >
                  分析文章
                </button>
                <button
                  onClick={() => setActiveTab('transcript')}
                  className={cn(
                    "flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded transition-all",
                    activeTab === 'transcript' 
                      ? "bg-gold text-dark-ebony shadow-lg" 
                      : "bg-dark-charcoal/80 text-white/50 border border-border-subtle hover:text-gold"
                  )}
                >
                  原始逐字稿
                </button>
              </div>
            )}

            {/* Blog Content Container */}
            <div className="flex-1 overflow-y-auto bg-white/[0.03] p-6 pt-20 md:p-14 md:pt-20 rounded-t-xl border-x border-t border-white/5 shadow-2xl shadow-black relative custom-scrollbar">
              {!blogPost && !fullTranscript && !isProcessing ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-20 hover:opacity-40 transition-opacity">
                  <div className="w-20 h-20 rounded-full border border-gold flex items-center justify-center">
                    <Sparkles className="w-10 h-10 text-gold" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-serif italic tracking-wide">等待指令中</h2>
                    <p className="text-[10px] uppercase tracking-[0.3em]">輸入模型與連結，AI 將開始掃描並撰寫</p>
                  </div>
                </div>
              ) : isProcessing && !blogPost ? (
                <div className="h-full flex flex-col items-center justify-center space-y-6">
                  <Loader2 className="w-10 h-10 text-gold animate-spin" />
                  <p className="text-xs uppercase tracking-[0.2em] font-light animate-pulse text-center leading-loose">
                    {statusMsg || '生成文章中...'}
                  </p>
                  
                  {interimTranscript && (
                    <div className="w-full max-w-2xl mt-4 p-4 bg-white/[0.02] border border-white/5 rounded text-left shadow-inner flex flex-col max-h-[40vh]">
                      <p className="text-[10px] text-gold/80 mb-3 uppercase tracking-widest border-b border-white/5 pb-2 shrink-0">即時聽寫進度</p>
                      <div className="overflow-y-auto custom-scrollbar flex-1 pr-2">
                        <p className="text-lg text-white/70 leading-relaxed font-serif whitespace-pre-wrap">{interimTranscript}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <article className="prose max-w-none">
                  {activeTab === 'blog' ? (
                    <div id="blog-post-content" className="p-4 rounded-xl">
                      <span className="text-[10px] uppercase tracking-[0.3em] text-gold mb-6 block font-bold">深度分析與洞察</span>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {blogPost}
                      </ReactMarkdown>

                      {/* Cost Summary Table within Blog Post View */}
                      {usageInfo && (
                        <div className="mt-16 pt-8 border-t border-white/10 html2pdf-avoid-break">
                          <h3 className="text-sm font-bold text-white/80 mb-4 uppercase tracking-widest">系統總結 (System Summary)</h3>
                          <div className="bg-dark-charcoal/50 border border-border-subtle rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-wrap">
                            {usageInfo.transcriptLength !== undefined && (
                              <div className="space-y-1">
                                <p className="text-[11px] text-white/50 uppercase tracking-wider">原始逐字稿字數</p>
                                <p className="text-xl font-mono text-gold">{usageInfo.transcriptLength.toLocaleString()}</p>
                              </div>
                            )}
                            {usageInfo.blogLength !== undefined && (
                              <div className="space-y-1">
                                <p className="text-[11px] text-white/50 uppercase tracking-wider">分析文章總字數</p>
                                <p className="text-xl font-mono text-gold">{usageInfo.blogLength.toLocaleString()}</p>
                              </div>
                            )}
                            <div className="space-y-1">
                              <p className="text-[11px] text-white/50 uppercase tracking-wider">預計消耗 Token</p>
                              <p className="text-xl font-mono text-white/90">{usageInfo.tokens.toLocaleString()}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] text-white/50 uppercase tracking-wider">估算總花費</p>
                              <p className="text-xl font-mono text-white font-bold">NT$ {((usageInfo.costTWD || 0) + (usageInfo.whisperCostTWD || 0)).toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className="text-[10px] uppercase tracking-[0.3em] text-gold mb-6 block font-bold">原始完整逐字稿</span>
                      <div className="text-white/80 whitespace-pre-wrap leading-relaxed font-serif text-lg">
                        {fullTranscript}
                      </div>
                    </>
                  )}
                </article>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-8 bg-dark-charcoal border-t border-border-subtle flex items-center justify-between px-8 shrink-0">
        <div className="flex gap-6">
          <span className="text-[9px] uppercase tracking-[0.15em] text-gold font-bold">引擎: {GEN_MODELS.find(m => m.id === selectedModel)?.name}</span>
          {usageInfo && (
            <span className="text-[9px] uppercase tracking-[0.15em] text-white/60 font-medium whitespace-nowrap">
              預計消耗: <span className="text-gold">{usageInfo.tokens.toLocaleString()} Tokens</span> 
              <span className="mx-2 opacity-30">|</span>
              文章費用: <span className="text-gold">NT$ {usageInfo.costTWD.toFixed(2)}</span>
              {usageInfo.whisperCostTWD && usageInfo.whisperCostTWD > 0 ? (
                <>
                  <span className="mx-2 opacity-30">|</span>
                  聽寫費用: <span className="text-gold">NT$ {usageInfo.whisperCostTWD.toFixed(2)}</span>
                  <span className="mx-2 opacity-30">|</span>
                  總計: <span className="text-gold font-bold">NT$ {(usageInfo.costTWD + usageInfo.whisperCostTWD).toFixed(2)}</span>
                </>
              ) : null}
            </span>
          )}
          <span className="text-[9px] uppercase tracking-[0.15em] opacity-30 font-medium hidden md:inline">現在時間: {new Date().toLocaleTimeString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            isProcessing ? "bg-amber-500 animate-pulse" : "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
          )}></div>
          <span className="text-[9px] uppercase tracking-[0.2em] opacity-40 font-bold">系統 {isProcessing ? '處理中' : '安全運作中'}</span>
        </div>
      </footer>
    </div>
  );
}


